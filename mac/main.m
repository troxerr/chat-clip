#import <Cocoa/Cocoa.h>
#import <AVFoundation/AVFoundation.h>
#import <dispatch/dispatch.h>
#import <signal.h>
#import <fcntl.h>
#import <unistd.h>
#import <Security/Security.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <ServiceManagement/ServiceManagement.h>
#import <UserNotifications/UserNotifications.h>
#import "ui/HDUI.h"
#import "ui/HDSymbols.h"
#import "license/HDLicenseManager.h"
#import "migration/HDMigration.h"

#if __has_include(<Sparkle/Sparkle.h>)
#import <Sparkle/Sparkle.h>
#define HD_SPARKLE 1
#endif

static NSString *const kDashboardURL = @"https://clipspike.com/";
static NSString *const kDropboxHomeURL = @"https://www.dropbox.com/home";
static NSString *const kGoogleDriveHomeURL = @"https://drive.google.com";
static NSString *const kKeychainService = @"com.clipspike.app.credentials";

static BOOL HDKeychainDisabled(void) {
  return [HDEnv(@"CLIPSPIKE_KEYCHAIN") isEqualToString:@"0"];
}

static NSString *HDKeychainGet(NSString *account) {
  if (HDKeychainDisabled() || !account.length) return nil;
  NSDictionary *query = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kKeychainService,
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecReturnData: @YES,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
  };
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status != errSecSuccess || !result) return nil;
  NSData *data = (__bridge_transfer NSData *)result;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static BOOL HDKeychainExists(NSString *account) {
  if (HDKeychainDisabled() || !account.length) return NO;
  NSDictionary *query = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kKeychainService,
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecReturnAttributes: @YES,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
  };
  return SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL) == errSecSuccess;
}

static BOOL HDKeychainSet(NSString *account, NSString *value) {
  if (HDKeychainDisabled() || !account.length || !value.length) return NO;
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *query = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kKeychainService,
    (__bridge id)kSecAttrAccount: account
  };
  NSDictionary *attributes = @{
    (__bridge id)kSecValueData: data,
    (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlock
  };
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
  if (status == errSecItemNotFound) {
    NSMutableDictionary *add = [query mutableCopy];
    [add addEntriesFromDictionary:attributes];
    status = SecItemAdd((__bridge CFDictionaryRef)add, NULL);
  }
  return status == errSecSuccess;
}

static void HDKeychainDelete(NSString *account) {
  if (HDKeychainDisabled() || !account.length) return;
  NSDictionary *query = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kKeychainService,
    (__bridge id)kSecAttrAccount: account
  };
  SecItemDelete((__bridge CFDictionaryRef)query);
}
static NSString *const kConfigTemplate =
@"{\n"
"  \"reframe\": {\n"
"    \"enabled\": true,\n"
"    \"width\": 1080,\n"
"    \"height\": 1920,\n"
"    \"crf\": 20,\n"
"    \"preset\": \"veryfast\",\n"
"    \"blur\": 20,\n"
"    \"encoder\": \"h264_videotoolbox\",\n"
"    \"bitrate\": \"8M\"\n"
"  },\n"
"  \"storage\": {\n"
"    \"mode\": \"local\",\n"
"    \"folder\": \"/ClipSpike\",\n"
"    \"deleteAfterUpload\": true,\n"
"    \"keepLocalCopy\": false,\n"
"    \"keepRaw\": false\n"
"  },\n"
"  \"dropbox\": {\n"
"    \"enabled\": true,\n"
"    \"appKey\": \"\",\n"
"    \"appSecret\": \"\",\n"
"    \"refreshToken\": \"\",\n"
"    \"folder\": \"/ClipSpike\",\n"
"    \"deleteAfterUpload\": true\n"
"  },\n"
"  \"googleDrive\": {\n"
"    \"enabled\": true,\n"
"    \"clientId\": \"\",\n"
"    \"clientSecret\": \"\",\n"
"    \"refreshToken\": \"\",\n"
"    \"folder\": \"/ClipSpike\"\n"
"  },\n"
"  \"license\": {\n"
"    \"trialStartedAt\": \"\",\n"
"    \"lastValidatedAt\": \"\",\n"
"    \"email\": \"\",\n"
"    \"productName\": \"\"\n"
"  }\n"
"}\n";

@interface Desk : NSObject <NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, NSTableViewDataSource, NSTableViewDelegate>
@property(strong) HDUI *ui;
@property(strong) NSWindow *window;
@property(strong) NSTextField *channel;
@property(strong) NSTextField *status;
@property(strong) NSTextField *telemetry;
@property(strong) NSButton *toggle;
@property(strong) NSButton *saveButton;
@property(strong) NSButton *lastClipButton;
@property(strong) NSTask *task;
@property(strong) NSTask *caffeinate;
@property(strong) NSMutableString *stdoutBuffer;
@property(strong) NSMutableArray<NSString *> *logLines;
@property(strong) NSMenuItem *loginItemMenuItem;
@property(strong) NSMenuItem *notificationsMenuItem;
@property BOOL notificationsEnabled;
@property BOOL notificationsAuthorized;
@property(copy) NSString *lastClipPath;
@property(copy) NSString *lastError;
@property(copy) NSString *configPath;
@property(copy) NSString *outputPath;
@property(strong) NSCache *clipPreviewCache;
@property(strong) NSCache *clipMetaCache;
@property(strong) NSMutableSet *pendingClipPreviews;
@property(copy) NSString *storageMode;
@property(copy) NSString *storageLabel;
@property(copy) NSString *lastRemoteURL;
@property(strong) NSWindow *storageWindow;
@property(strong) NSPopUpButton *storageModePopup;
@property(strong) NSTextField *storageStatus;
@property(strong) NSTextField *storageFolder;
@property(strong) NSButton *storageConnectButton;
@property(strong) NSButton *storageDisconnectButton;
@property(strong) NSButton *storageDeleteCheckbox;
@property(strong) NSButton *storageKeepLocalCheckbox;
@property(strong) NSButton *storageKeepRawCheckbox;
@property(strong) NSTask *oauthTask;
@property(strong) NSMutableData *oauthOutput;
@property(strong) NSWindow *onboardingWindow;
@property(strong) NSTextField *onboardingChannel;
@property(strong) NSButton *onboardingPermission;
@property(strong) NSWindow *historyWindow;
@property(strong) NSTableView *historyTable;
@property(strong) NSTextField *historyStatus;
@property(strong) NSButton *historyOpenButton;
@property(strong) NSMutableArray<NSDictionary *> *historyItems;
@property(strong) NSMutableArray<NSDictionary *> *queueItems;
@property(copy) NSString *stateDir;
@property(strong) NSWindow *licenseWindow;
@property(strong) NSTextField *licenseStatusLabel;
@property(strong) NSTextField *licenseTrialLabel;
@property(strong) NSTextField *licenseKeyField;
@property(strong) NSButton *licenseActivateButton;
@property(strong) NSButton *licenseDeactivateButton;
@property(strong) NSButton *licenseCheckButton;
@property(strong) NSButton *licenseBuyButton;
@property(strong) NSTask *licenseTask;
@property(strong) NSMutableData *licenseOutput;
#if HD_SPARKLE
@property(strong) SPUStandardUpdaterController *updaterController;
#endif
@property(copy) NSString *licenseAction;
@property BOOL licenseValid;
@property(nonatomic, copy) NSString *licenseValidationMessage;
@property(strong, nonatomic) HDLicenseManager *licenseManager;
@property(copy) NSString *pendingLicenseKey;
@property BOOL licenseRequired;
@property BOOL licenseSilent;
@property BOOL licenseValidationAttempted;
@property NSInteger trialDays;
@property NSInteger clipCount;
@property NSInteger queuedCount;
@property BOOL dropboxConfigured;
@property BOOL storageConfigured;
@property BOOL reframeEnabled;
@property BOOL quitting;
@property(strong) NSTask *vodTask;
@property(strong) NSMutableString *vodStdoutBuffer;
@property BOOL vodEvents;
@property BOOL vodCancelled;
@property BOOL vodFatal;
@property NSInteger vodMomentCount;
@property NSInteger vodRequested;
@property NSInteger vodSaved;
@property(copy) NSString *lastClipId;
@property(strong) NSWindow *monitorWindow;
@property(strong) NSTextView *monitorText;
@property(strong) NSTextField *monitorHealth;
@property(strong) NSButton *monitorAuto;
@property(strong) NSButton *monitorMissed;
@property(strong) NSTask *monitorTask;
@property(strong) NSDictionary *monitorSnapshot;
@property(strong) NSDictionary *monitorReport;
@property(strong) NSStatusItem *statusItem;
@property(strong) NSMenuItem *statusStateItem;
@property(strong) NSMenuItem *statusToggleItem;
@property(strong) NSTimer *statusTimer;
@property(copy) NSString *statusItemSignature;
@property BOOL suppressPreviewUpdate;
@end

static NSFont *HDDeskMono(CGFloat size) {
  NSFont *font = [NSFont fontWithName:@"JetBrainsMono-Regular" size:size];
  if (!font) font = [NSFont fontWithName:@"GeistMono-Regular" size:size];
  if (!font) font = [NSFont monospacedSystemFontOfSize:size weight:NSFontWeightRegular];
  return font;
}

static NSString *HDByteString(unsigned long long bytes) {
  if (bytes < 1024) return [NSString stringWithFormat:@"%llu B", bytes];
  if (bytes < 1024ull * 1024) return [NSString stringWithFormat:@"%.1f KB", bytes / 1024.0];
  if (bytes < 1024ull * 1024 * 1024) return [NSString stringWithFormat:@"%.1f MB", bytes / (1024.0 * 1024.0)];
  return [NSString stringWithFormat:@"%.2f GB", bytes / (1024.0 * 1024.0 * 1024.0)];
}

@implementation Desk

- (NSMutableDictionary *)loadConfig {
  NSString *path = self.configPath.length ? self.configPath : [NSHomeDirectory() stringByAppendingPathComponent:@".clipspike.json"];
  NSFileManager *manager = [NSFileManager defaultManager];
  if (![manager fileExistsAtPath:path]) {
    [manager createDirectoryAtPath:[path stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
    NSData *data = [kConfigTemplate dataUsingEncoding:NSUTF8StringEncoding];
    [manager createFileAtPath:path contents:data attributes:@{NSFilePosixPermissions: @0600}];
  }
  [self mergeConfigDefaultsAtPath:path];
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) return nil;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:&error];
  return [parsed isKindOfClass:[NSMutableDictionary class]] ? parsed : nil;
}

- (BOOL)writeConfig:(NSDictionary *)config {
  if (!config) return NO;
  NSString *path = self.configPath.length ? self.configPath : [NSHomeDirectory() stringByAppendingPathComponent:@".clipspike.json"];
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:config options:NSJSONWritingPrettyPrinted error:&error];
  if (!data) return NO;
  BOOL ok = [data writeToFile:path atomically:YES];
  if (ok) [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:path error:nil];
  return ok;
}

- (void)migrateCredentialsIfNeeded {
  NSMutableDictionary *config = [self loadConfig];
  if (!config) return;
  BOOL changed = NO;
  NSMutableDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSMutableDictionary class]] ? config[@"dropbox"] : nil;
  NSString *dropboxToken = [dropbox[@"refreshToken"] isKindOfClass:[NSString class]] ? dropbox[@"refreshToken"] : @"";
  if (dropboxToken.length) {
    if (!HDKeychainExists(@"dropbox.refresh")) {
      if (HDKeychainSet(@"dropbox.refresh", dropboxToken)) {
        dropbox[@"refreshToken"] = @"";
        changed = YES;
      }
    } else {
      dropbox[@"refreshToken"] = @"";
      changed = YES;
    }
  }
  NSString *dropboxSecret = [dropbox[@"appSecret"] isKindOfClass:[NSString class]] ? dropbox[@"appSecret"] : @"";
  if (dropboxSecret.length) {
    if (HDKeychainSet(@"dropbox.appSecret", dropboxSecret)) {
      dropbox[@"appSecret"] = @"";
      changed = YES;
    }
  }
  NSMutableDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSMutableDictionary class]] ? config[@"googleDrive"] : nil;
  NSString *googleToken = [google[@"refreshToken"] isKindOfClass:[NSString class]] ? google[@"refreshToken"] : @"";
  if (googleToken.length) {
    if (!HDKeychainExists(@"google.refresh")) {
      if (HDKeychainSet(@"google.refresh", googleToken)) {
        google[@"refreshToken"] = @"";
        changed = YES;
      }
    } else {
      google[@"refreshToken"] = @"";
      changed = YES;
    }
  }
  if (changed) [self writeConfig:config];
}

- (NSString *)keychainAccountForMode:(NSString *)mode {
  if ([mode isEqualToString:@"dropbox"]) return @"dropbox.refresh";
  if ([mode isEqualToString:@"googleDrive"]) return @"google.refresh";
  return nil;
}

- (NSString *)tokenForMode:(NSString *)mode {
  NSString *account = [self keychainAccountForMode:mode];
  if (!account) return nil;
  NSString *token = HDKeychainGet(account);
  if (token.length) return token;
  NSMutableDictionary *config = [self loadConfig];
  if ([mode isEqualToString:@"dropbox"]) {
    NSDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSDictionary class]] ? config[@"dropbox"] : nil;
    return [dropbox[@"refreshToken"] isKindOfClass:[NSString class]] ? dropbox[@"refreshToken"] : nil;
  }
  NSDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSDictionary class]] ? config[@"googleDrive"] : nil;
  return [google[@"refreshToken"] isKindOfClass:[NSString class]] ? google[@"refreshToken"] : nil;
}

- (NSString *)accountForMode:(NSString *)mode {
  NSMutableDictionary *config = [self loadConfig];
  if ([mode isEqualToString:@"dropbox"]) {
    NSDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSDictionary class]] ? config[@"dropbox"] : nil;
    return [dropbox[@"account"] isKindOfClass:[NSString class]] ? dropbox[@"account"] : @"";
  }
  if ([mode isEqualToString:@"googleDrive"]) {
    NSDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSDictionary class]] ? config[@"googleDrive"] : nil;
    return [google[@"email"] isKindOfClass:[NSString class]] ? google[@"email"] : @"";
  }
  return @"";
}

- (NSString *)infoOrEnvironment:(NSString *)key environment:(NSString *)environment fallback:(NSString *)fallback {
  NSString *value = NSBundle.mainBundle.infoDictionary[key];
  if (![value isKindOfClass:[NSString class]] || !value.length) value = HDEnv(environment);
  if (![value isKindOfClass:[NSString class]] || !value.length) value = fallback;
  return value ?: @"";
}

- (void)applyStorageEnvironment:(NSMutableDictionary *)environment {
  NSMutableDictionary *config = [self loadConfig];
  NSDictionary *storage = [config[@"storage"] isKindOfClass:[NSDictionary class]] ? config[@"storage"] : nil;
  NSString *mode = [storage[@"mode"] isKindOfClass:[NSString class]] ? storage[@"mode"] : @"local";
  NSString *folder = [storage[@"folder"] isKindOfClass:[NSString class]] ? storage[@"folder"] : @"/ClipSpike";
  environment[@"CLIPSPIKE_STORAGE"] = mode;
  // An ended trial refuses a new capture. It does not fall through to the watermark plan.
  environment[@"CLIPSPIKE_PLAN"] = @"pro";
  environment[@"CLIPSPIKE_CONFIG"] = self.configPath;
  if (self.stateDir.length) environment[@"CLIPSPIKE_STATE"] = self.stateDir;

  NSDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSDictionary class]] ? config[@"dropbox"] : nil;
  NSString *dropboxKey = [self infoOrEnvironment:@"HDDropboxAppKey" environment:@"CLIPSPIKE_DROPBOX_APP_KEY" fallback:dropbox[@"appKey"]];
  NSString *dropboxSecret = [self infoOrEnvironment:@"HDDropboxAppSecret" environment:@"CLIPSPIKE_DROPBOX_APP_SECRET" fallback:dropbox[@"appSecret"]];
  if (!dropboxSecret.length) dropboxSecret = HDKeychainGet(@"dropbox.appSecret") ?: @"";
  NSString *dropboxToken = [self tokenForMode:@"dropbox"];
  if (dropboxKey.length) environment[@"DROPBOX_APP_KEY"] = dropboxKey;
  if (dropboxSecret.length) environment[@"DROPBOX_APP_SECRET"] = dropboxSecret;
  if (dropboxToken.length) environment[@"DROPBOX_REFRESH_TOKEN"] = dropboxToken;
  environment[@"DROPBOX_FOLDER"] = folder;

  NSDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSDictionary class]] ? config[@"googleDrive"] : nil;
  NSString *googleId = [self infoOrEnvironment:@"HDGoogleClientId" environment:@"CLIPSPIKE_GOOGLE_CLIENT_ID" fallback:google[@"clientId"]];
  NSString *googleSecret = [self infoOrEnvironment:@"HDGoogleClientSecret" environment:@"CLIPSPIKE_GOOGLE_CLIENT_SECRET" fallback:google[@"clientSecret"]];
  NSString *googleToken = [self tokenForMode:@"googleDrive"];
  if (googleId.length) environment[@"GOOGLE_CLIENT_ID"] = googleId;
  if (googleSecret.length) environment[@"GOOGLE_CLIENT_SECRET"] = googleSecret;
  if (googleToken.length) environment[@"GOOGLE_REFRESH_TOKEN"] = googleToken;
  environment[@"GOOGLE_DRIVE_FOLDER"] = folder;
}

- (NSMutableDictionary *)licenseConfig {
  NSMutableDictionary *config = [self loadConfig];
  if (!config) return nil;
  NSMutableDictionary *license = [config[@"license"] isKindOfClass:[NSMutableDictionary class]] ? config[@"license"] : [NSMutableDictionary dictionary];
  config[@"license"] = license;
  return config;
}

// The key, instance ID and last-validated time live in the Keychain
// (HDLicenseManager). Older builds kept them in the plaintext config; move them once.
- (HDLicenseManager *)licenseManager {
  if (_licenseManager) return _licenseManager;
  HDLicenseManager *manager = [HDLicenseManager new];
  __weak typeof(self) weakSelf = self;
  manager.onStateChange = ^(HDLicenseStanding state) { [weakSelf licenseStateChanged:state]; };
  _licenseManager = manager;
  NSMutableDictionary *config = [self licenseConfig];
  NSMutableDictionary *legacy = config[@"license"];
  NSString *legacyKey = [legacy[@"key"] isKindOfClass:[NSString class]] ? legacy[@"key"] : @"";
  NSString *legacyInstance = [legacy[@"instance"] isKindOfClass:[NSString class]] ? legacy[@"instance"] : @"";
  if (legacyKey.length && legacyInstance.length) {
    NSDate *date = [[self licenseDateFormatter] dateFromString:[legacy[@"lastValidatedAt"] isKindOfClass:[NSString class]] ? legacy[@"lastValidatedAt"] : @""];
    [manager migrateLegacyKey:legacyKey instanceId:legacyInstance lastValidated:date];
    if (manager.hasCredentials) {
      legacy[@"key"] = @"";
      legacy[@"instance"] = @"";
      legacy[@"lastValidatedAt"] = @"";
      [self writeConfig:config];
    }
  }
  [manager refresh];
  return manager;
}

- (NSString *)licenseKeyValue { return self.licenseManager.licenseKey; }

- (NSString *)licenseInstanceValue { return self.licenseManager.instanceId; }

- (BOOL)licenseIsRequired {
  NSString *env = HDEnv(@"CLIPSPIKE_LICENSE_REQUIRED");
  if (env.length) return ![env isEqualToString:@"0"];
  return [NSBundle.mainBundle.infoDictionary[@"HDLicenseRequired"] boolValue];
}

- (NSInteger)configuredTrialDays {
  NSString *env = HDEnv(@"CLIPSPIKE_TRIAL_DAYS");
  if (env.length) return MAX(0, env.integerValue);
  NSInteger value = [NSBundle.mainBundle.infoDictionary[@"HDTrialDays"] integerValue];
  return value > 0 ? value : 7;
}

- (NSDateFormatter *)licenseDateFormatter {
  NSDateFormatter *formatter = [NSDateFormatter new];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX";
  return formatter;
}

- (void)startTrialIfNeeded {
  NSMutableDictionary *config = [self licenseConfig];
  if (!config) return;
  NSMutableDictionary *license = config[@"license"];
  if (![license[@"trialStartedAt"] isKindOfClass:[NSString class]] || ![license[@"trialStartedAt"] length]) {
    license[@"trialStartedAt"] = [[self licenseDateFormatter] stringFromDate:[NSDate date]];
    [self writeConfig:config];
  }
}

- (NSInteger)licenseTrialDaysLeft {
  [self startTrialIfNeeded];
  NSMutableDictionary *config = [self licenseConfig];
  NSString *started = config[@"license"][@"trialStartedAt"];
  NSDate *date = [[self licenseDateFormatter] dateFromString:started ?: @""];
  if (!date) return 0;
  NSInteger total = [self configuredTrialDays];
  NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:date];
  NSInteger used = (NSInteger)floor(MAX(0, elapsed) / 86400.0);
  return MAX(0, total - used);
}

// A paid license stays usable offline for 14 days after its last successful validation.
- (BOOL)licenseValidationFresh { return self.licenseManager.isWithinGrace; }

// Trial days, or the hard stop after the trial. The watermark allowance is not shown.
- (void)refreshPlanNote {
  if (!self.ui) return;
  NSString *note = nil;
  if (self.licenseRequired && !([self licenseKeyValue].length && self.licenseValid)) {
    NSInteger daysLeft = [self licenseTrialDaysLeft];
    note = daysLeft > 0
      ? [NSString stringWithFormat:@"Trial: %ld day%@ left", (long)daysLeft, daysLeft == 1 ? @"" : @"s"]
      : @"Trial ended. A license is required to capture.";
  }
  [self.ui setPlanNote:note];
}

// Nil when a new capture may start. Refreshes license state first so an open app
// notices a trial that ended while it was running.
- (NSString *)newCaptureBlockReason {
  [self refreshLicenseState];
  if (!self.licenseRequired || self.licenseValid) return nil;
  if ([self licenseKeyValue].length) return @"The license could not be checked for over 14 days. Connect to the internet to keep using the app.";
  return @"The trial has ended. Enter a license key to keep capturing.";
}

- (void)refreshLicenseState {
  (void)self.licenseManager;  // loads Keychain state and starts Sparkle if already licensed
  self.licenseRequired = [self licenseIsRequired];
  self.trialDays = [self configuredTrialDays];
  if (!self.licenseRequired) {
    self.licenseValid = YES;
    [self updateLicenseUI];
    [self refreshPlanNote];
    return;
  }
  [self startTrialIfNeeded];
  NSInteger daysLeft = [self licenseTrialDaysLeft];
  NSString *key = [self licenseKeyValue];
  NSString *instance = [self licenseInstanceValue];
  if (key.length && instance.length) {
    BOOL fresh = [self licenseValidationFresh];
    self.licenseValid = fresh || daysLeft > 0;
    if (!fresh && !self.licenseValidationAttempted) {
      self.licenseValidationAttempted = YES;
      [self runLicenseAction:@"validate" silent:YES];
    }
  } else {
    self.licenseValid = daysLeft > 0;
  }
  [self updateLicenseUI];
  [self refreshPlanNote];
  if (!self.licenseValid && !self.licenseWindow.isVisible) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self showLicense:nil];
    });
  }
}

- (NSString *)licenseApiBase {
  NSString *value = NSBundle.mainBundle.infoDictionary[@"HDLicenseApiBase"];
  if (![value isKindOfClass:[NSString class]] || !value.length) value = HDEnv(@"CLIPSPIKE_LICENSE_API_BASE");
  return value ?: @"";
}

- (NSString *)licenseProductId {
  NSString *value = NSBundle.mainBundle.infoDictionary[@"HDProductId"];
  if (![value isKindOfClass:[NSString class]] || !value.length) value = HDEnv(@"CLIPSPIKE_PRODUCT_ID");
  return value ?: @"";
}

- (NSString *)checkoutURL {
  NSString *value = NSBundle.mainBundle.infoDictionary[@"HDCheckoutURL"];
  if (![value isKindOfClass:[NSString class]] || !value.length) value = HDEnv(@"CLIPSPIKE_CHECKOUT_URL");
  return value ?: @"";
}

- (NSString *)priceLabel {
  NSString *value = NSBundle.mainBundle.infoDictionary[@"HDPriceLabel"];
  if (![value isKindOfClass:[NSString class]] || !value.length) value = HDEnv(@"CLIPSPIKE_PRICE_LABEL");
  return [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] ?: @"";
}

- (NSString *)buyButtonTitle {
  NSString *price = [self priceLabel];
  return price.length ? [NSString stringWithFormat:@"Buy for %@", price] : @"Buy a license";
}

- (void)clearLicense {
  [self.licenseManager clear];
  NSMutableDictionary *config = [self licenseConfig];
  if (!config) return;
  NSMutableDictionary *license = config[@"license"];
  license[@"email"] = @"";
  license[@"productName"] = @"";
  [self writeConfig:config];
}

// Sparkle only runs while a license is on file and recently validated. Trial and
// free-plan users do not get automatic update checks.
- (void)licenseStateChanged:(HDLicenseStanding)state {
#if HD_SPARKLE
  BOOL licensed = state == HDLicenseStandingValid;
  if (licensed && !self.updaterController) {
    NSString *feed = NSBundle.mainBundle.infoDictionary[@"SUFeedURL"];
    NSString *edKey = NSBundle.mainBundle.infoDictionary[@"SUPublicEDKey"];
    if ([feed isKindOfClass:[NSString class]] && feed.length && [edKey isKindOfClass:[NSString class]] && edKey.length) {
      self.updaterController = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:nil];
      [self.updaterController.updater setAutomaticallyChecksForUpdates:YES];
      [self.updaterController startUpdater];
    }
  } else if (!licensed && self.updaterController) {
    [self.updaterController.updater setAutomaticallyChecksForUpdates:NO];
  }
#endif
}

- (void)updateLicenseUI {
  if (!self.licenseStatusLabel || !self.licenseTrialLabel) return;
  if (!self.licenseRequired) {
    self.licenseStatusLabel.stringValue = @"Licensing is disabled in this development build.";
    self.licenseTrialLabel.stringValue = @"No license is required.";
    self.licenseKeyField.enabled = NO;
    self.licenseKeyField.stringValue = @"";
    self.licenseKeyField.enabled = NO;
    self.licenseActivateButton.enabled = NO;
    self.licenseDeactivateButton.enabled = NO;
    self.licenseCheckButton.enabled = NO;
    if (self.ui) {
      [self.ui setLicenseState:HDLicenseStateDisabled];
      [self.ui setCaptureOfferText:@"" buyTitle:@"" showBuy:NO showKey:NO];
      NSString *version = NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"];
      [self.ui setAccountLine:([version isKindOfClass:[NSString class]] && version.length) ? [NSString stringWithFormat:@"v%@", version] : @""];
    }
    return;
  }
  NSInteger daysLeft = [self licenseTrialDaysLeft];
  NSString *key = [self licenseKeyValue];
  NSString *instance = [self licenseInstanceValue];
  NSMutableDictionary *config = [self licenseConfig];
  NSString *email = config[@"license"][@"email"];
  BOOL hasKey = key.length > 0 && instance.length > 0;
  BOOL checkout = [self checkoutURL].length > 0;
  NSString *buyTitle = [self buyButtonTitle];
  HDLicenseState state = HDLicenseStateTrial;
  NSString *offer = @"";
  BOOL showBuy = NO;
  BOOL showKey = NO;
  NSString *account = @"";
  if (key.length && [self licenseValidationFresh]) {
    self.licenseStatusLabel.stringValue = email.length ? [NSString stringWithFormat:@"Licensed to %@.", email] : @"Licensed.";
    state = HDLicenseStateValid;
    account = @"Licensed";
  } else if (key.length && daysLeft > 0) {
    self.licenseStatusLabel.stringValue = @"Licensed. The license could not be checked recently; it will be checked again when you are online.";
    state = HDLicenseStateTrial;
    offer = self.licenseStatusLabel.stringValue;
    account = @"Licensed";
  } else if (key.length) {
    self.licenseStatusLabel.stringValue = @"The license could not be checked for over 14 days. Connect to the internet to keep using the app.";
    state = HDLicenseStateExpired;
    offer = self.licenseStatusLabel.stringValue;
    showBuy = checkout;
    showKey = YES;
    account = @"Trial ended";
  } else if (daysLeft > 0) {
    self.licenseStatusLabel.stringValue = [NSString stringWithFormat:@"Trial: %ld day%@ left.", (long)daysLeft, daysLeft == 1 ? @"" : @"s"];
    state = HDLicenseStateTrial;
    offer = self.licenseStatusLabel.stringValue;
    showBuy = checkout;
    account = [NSString stringWithFormat:@"Trial · %ldd", (long)daysLeft];
  } else {
    self.licenseStatusLabel.stringValue = @"The trial has ended. Enter a license key to keep capturing.";
    state = HDLicenseStateExpired;
    offer = self.licenseStatusLabel.stringValue;
    showBuy = checkout;
    showKey = YES;
    account = @"Trial ended";
  }
  self.licenseTrialLabel.stringValue = state == HDLicenseStateValid || (key.length && daysLeft > 0) ? @"Licensed" : (daysLeft > 0 ? @"Trial" : @"Expired");
  if (self.licenseValidationMessage.length) {
    self.licenseStatusLabel.stringValue = self.licenseValidationMessage;
    offer = self.licenseValidationMessage;
  }
  if (self.licenseTask) self.licenseStatusLabel.stringValue = @"Contacting the license service…";
  self.licenseKeyField.enabled = !self.licenseTask;
  self.licenseActivateButton.enabled = self.licenseKeyField.enabled;
  self.licenseDeactivateButton.enabled = !self.licenseTask && hasKey;
  self.licenseCheckButton.enabled = !self.licenseTask && hasKey;
  self.licenseBuyButton.enabled = checkout;
  self.licenseBuyButton.title = buyTitle;
  if (self.ui) {
    [self.ui setLicenseState:state];
    [self.ui setLicenseEntryVisible:!hasKey && state != HDLicenseStateDisabled && state != HDLicenseStateValid];
    if (!checkout) self.ui.licenseBuyButton.hidden = YES;
    [self.ui setCaptureOfferText:offer buyTitle:buyTitle showBuy:showBuy showKey:showKey];
    NSString *version = NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"];
    NSString *line = [version isKindOfClass:[NSString class]] && version.length ? [NSString stringWithFormat:@"v%@", version] : @"";
    if (account.length) line = line.length ? [NSString stringWithFormat:@"%@ · %@", line, account] : account;
    [self.ui setAccountLine:line];
  }
}

- (void)showLicense:(id)sender {
  if (self.ui) { [self.ui selectPage:HDPageLicense]; [self updateLicenseUI]; return; }
  if (!self.licenseWindow) {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 520, 380)
                                                   styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"License";
    window.releasedWhenClosed = NO;
    NSView *view = window.contentView;

    NSTextField *heading = [NSTextField labelWithString:@"ClipSpike License"];
    heading.font = [NSFont boldSystemFontOfSize:20];
    heading.frame = NSMakeRect(24, 328, 472, 26);
    [view addSubview:heading];

    self.licenseTrialLabel = [NSTextField labelWithString:@""];
    self.licenseTrialLabel.font = [NSFont systemFontOfSize:12];
    self.licenseTrialLabel.textColor = [NSColor secondaryLabelColor];
    self.licenseTrialLabel.frame = NSMakeRect(24, 302, 472, 18);
    [view addSubview:self.licenseTrialLabel];

    self.licenseStatusLabel = [NSTextField wrappingLabelWithString:@""];
    self.licenseStatusLabel.frame = NSMakeRect(24, 250, 472, 42);
    [view addSubview:self.licenseStatusLabel];

    NSTextField *keyLabel = [NSTextField labelWithString:@"License key"];
    keyLabel.frame = NSMakeRect(24, 218, 100, 18);
    [view addSubview:keyLabel];

    self.licenseKeyField = [NSTextField textFieldWithString:@""];
    self.licenseKeyField.placeholderString = @"Paste your license key";
    self.licenseKeyField.frame = NSMakeRect(24, 184, 472, 28);
    [view addSubview:self.licenseKeyField];

    self.licenseActivateButton = [NSButton buttonWithTitle:@"Activate" target:self action:@selector(activateLicense:)];
    self.licenseActivateButton.frame = NSMakeRect(24, 140, 100, 32);
    [view addSubview:self.licenseActivateButton];

    self.licenseDeactivateButton = [NSButton buttonWithTitle:@"Deactivate" target:self action:@selector(deactivateLicense:)];
    self.licenseDeactivateButton.frame = NSMakeRect(132, 140, 110, 32);
    [view addSubview:self.licenseDeactivateButton];

    self.licenseCheckButton = [NSButton buttonWithTitle:@"Check License" target:self action:@selector(checkLicense:)];
    self.licenseCheckButton.frame = NSMakeRect(250, 140, 130, 32);
    [view addSubview:self.licenseCheckButton];

    self.licenseBuyButton = [NSButton buttonWithTitle:[self buyButtonTitle] target:self action:@selector(buyLicense:)];
    self.licenseBuyButton.frame = NSMakeRect(388, 140, 108, 32);
    [view addSubview:self.licenseBuyButton];

    NSTextField *note = [NSTextField wrappingLabelWithString:@"A 7-day trial starts on first launch. After it ends, a new capture does not start until you activate a license. A license can be used on up to two computers. Validation requires an internet connection once every 14 days."];
    note.font = [NSFont systemFontOfSize:11];
    note.textColor = [NSColor secondaryLabelColor];
    note.frame = NSMakeRect(24, 76, 472, 42);
    [view addSubview:note];

    NSButton *close = [NSButton buttonWithTitle:@"Close" target:self action:@selector(closeLicense:)];
    close.frame = NSMakeRect(24, 28, 100, 32);
    [view addSubview:close];

    self.licenseWindow = window;
    [window center];
  }
  [self updateLicenseUI];
  [self.licenseWindow makeKeyAndOrderFront:nil];
}

- (void)closeLicense:(id)sender {
  [self.licenseWindow close];
}

- (void)buyLicense:(id)sender {
  NSString *url = [self checkoutURL];
  if (!url.length) {
    [self alert:@"Checkout is not configured" info:@"Set HDCheckoutURL when building the release."];
    return;
  }
  [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:url]];
}

- (void)runLicenseAction:(NSString *)action silent:(BOOL)silent {
  if (self.licenseTask) return;
  if ([action isEqualToString:@"activate"] && ![self licenseProductId].length) {
    // Without a product ID any Lemon Squeezy key would activate.
    if (!silent) [self alert:@"Licensing is not configured" info:@"This build has no product ID. Set HDProductId when building the release."];
    return;
  }
  NSString *resource = NSBundle.mainBundle.resourcePath;
  NSString *helper = [resource stringByAppendingPathComponent:@"tools/license.js"];
  NSString *node = [resource stringByAppendingPathComponent:@"node"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:helper]) {
    if (!silent) [self alert:@"License helper missing" info:@"Rebuild the app with mac/build.sh."];
    return;
  }
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:node]) node = [self findTool:@"node" paths:[self searchPaths]];
  if (!node) {
    if (!silent) [self alert:@"Node.js not found" info:@"Rebuild the app with mac/build.sh."];
    return;
  }
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:node];
  task.arguments = @[helper, @"--action", action];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"PATH"] = [[self searchPaths] componentsJoinedByString:@":"];
  // An activation uses the key typed by the user; it is stored only after Lemon Squeezy accepts it.
  NSString *key = [action isEqualToString:@"activate"] ? (self.pendingLicenseKey ?: @"") : [self licenseKeyValue];
  NSString *instance = [self licenseInstanceValue];
  if (key.length) environment[@"LEMON_LICENSE_KEY"] = key;
  if (instance.length) environment[@"LEMON_INSTANCE_ID"] = instance;
  if ([self licenseProductId].length) environment[@"LEMON_PRODUCT_ID"] = [self licenseProductId];
  if ([self licenseApiBase].length) environment[@"LEMON_API_BASE"] = [self licenseApiBase];
  environment[@"LEMON_INSTANCE_NAME"] = [HDLicenseManager instanceName];
  task.environment = environment;

  NSPipe *stdoutPipe = [NSPipe pipe];
  NSPipe *stderrPipe = [NSPipe pipe];
  task.standardOutput = stdoutPipe;
  task.standardError = stderrPipe;
  self.licenseOutput = [NSMutableData data];
  self.licenseTask = task;
  self.licenseAction = action;
  self.licenseSilent = silent;
  if (!silent) self.licenseStatusLabel.stringValue = @"Contacting the license service…";
  self.licenseKeyField.enabled = NO;
  self.licenseActivateButton.enabled = NO;
  self.licenseCheckButton.enabled = NO;
  self.licenseDeactivateButton.enabled = NO;

  __weak typeof(self) weakSelf = self;
  stdoutPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length || !weakSelf.licenseOutput) return;
    @synchronized(weakSelf.licenseOutput) { [weakSelf.licenseOutput appendData:data]; }
  };
  stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    (void)handle.availableData;
  };
  task.terminationHandler = ^(NSTask *finished) {
    NSData *remaining = [[finished.standardOutput fileHandleForReading] readDataToEndOfFile];
    if (remaining.length) {
      @synchronized(weakSelf.licenseOutput) {
        if (weakSelf.licenseOutput) [weakSelf.licenseOutput appendData:remaining];
      }
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf finishLicenseAction:finished]; });
  };
  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    self.licenseTask = nil;
    if (!silent) [self alert:@"Could not check the license" info:error.localizedDescription];
    [self updateLicenseUI];
  }
}

- (void)finishLicenseAction:(NSTask *)task {
  self.licenseTask = nil;
  NSData *data = self.licenseOutput ? [self.licenseOutput copy] : [NSData data];
  self.licenseOutput = nil;
  NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
  NSDictionary *result = nil;
  for (NSString *line in [[text componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]] reverseObjectEnumerator]) {
    NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (![trimmed hasPrefix:@"{"]) continue;
    id parsed = [NSJSONSerialization JSONObjectWithData:[trimmed dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if ([parsed isKindOfClass:[NSDictionary class]]) { result = parsed; break; }
  }
  NSString *action = self.licenseAction ?: @"validate";
  BOOL actionOK = [result[@"ok"] boolValue];
  BOOL ok = actionOK && [result[@"valid"] boolValue];
  BOOL success = [action isEqualToString:@"deactivate"] ? actionOK : ok;
  if (success) self.licenseValidationMessage = nil;
  if ([action isEqualToString:@"deactivate"] && actionOK) {
    [self clearLicense];
    self.licenseValid = [self licenseTrialDaysLeft] > 0;
  } else if ([action isEqualToString:@"activate"] && [result[@"ok"] boolValue]) {
    NSString *instanceId = [result[@"instanceId"] isKindOfClass:[NSString class]] ? result[@"instanceId"] : @"";
    if (instanceId.length && self.pendingLicenseKey.length) {
      [self.licenseManager recordActivationWithKey:self.pendingLicenseKey instanceId:instanceId];
      self.pendingLicenseKey = nil;
      NSMutableDictionary *config = [self licenseConfig];
      NSMutableDictionary *license = config[@"license"];
      license[@"email"] = [result[@"customerEmail"] isKindOfClass:[NSString class]] ? result[@"customerEmail"] : @"";
      license[@"productName"] = [result[@"productName"] isKindOfClass:[NSString class]] ? result[@"productName"] : @"";
      [self writeConfig:config];
      self.licenseValid = YES;
    }
  } else if ([action isEqualToString:@"validate"] && ok) {
    [self.licenseManager recordValidation];
    NSMutableDictionary *config = [self licenseConfig];
    if ([result[@"customerEmail"] isKindOfClass:[NSString class]]) config[@"license"][@"email"] = result[@"customerEmail"];
    [self writeConfig:config];
    self.licenseValid = YES;
  } else if ([action isEqualToString:@"validate"]) {
    // Offline or a server error says nothing about the key: keep it, and the 14-day grace applies.
    // A provider rejection ends grace while preserving the activation for retry or removal.
    BOOL transient = !result || [result[@"transient"] boolValue];
    if (!transient) [self.licenseManager invalidateValidation];
    self.licenseValidationMessage = [result[@"error"] isKindOfClass:[NSString class]] ? result[@"error"]
      : [result[@"status"] isEqual:@"expired"] ? @"This license has expired."
      : transient ? @"Could not reach the license service. Check your connection and try again."
      : @"This license is not active.";
    self.licenseValid = (transient && self.licenseManager.isWithinGrace) || [self licenseTrialDaysLeft] > 0;
  }
  if ([action isEqualToString:@"activate"]) self.pendingLicenseKey = nil;
  [self refreshPlanNote];
  [self updateLicenseUI];
  if (!self.licenseSilent) {
    if (success) {
      [self alert:[action isEqualToString:@"deactivate"] ? @"License deactivated" : @"License active"
             info:[action isEqualToString:@"deactivate"] ? @"This Mac has been deactivated." : @"Your license is active on this Mac."];
    } else {
      NSString *message = [result[@"error"] isKindOfClass:[NSString class]] ? result[@"error"] : @"The license could not be verified.";
      [self alert:@"License not active" info:message];
    }
  }
  if (!self.licenseValid && !self.licenseWindow.isVisible) [self showLicense:nil];
}

- (NSString *)usageLogPath {
  NSString *dir = self.stateDir.length ? self.stateDir : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClipSpike"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return [dir stringByAppendingPathComponent:@"usage.jsonl"];
}

- (void)logUsageEvent:(NSString *)event details:(NSDictionary *)details {
  if (!event.length) return;
  NSMutableDictionary *record = [NSMutableDictionary dictionary];
  record[@"at"] = [[NSISO8601DateFormatter new] stringFromDate:[NSDate date]] ?: @"";
  record[@"event"] = event;
  record[@"version"] = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"";
  record[@"build"] = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"";
  if (details.count) {
    NSMutableDictionary *safe = [details mutableCopy];
    for (NSString *key in [safe.allKeys copy]) {
      if ([key.lowercaseString containsString:@"token"] || [key.lowercaseString containsString:@"secret"] || [key.lowercaseString containsString:@"password"] || [key.lowercaseString containsString:@"licensekey"]) {
        [safe removeObjectForKey:key];
      }
    }
    record[@"details"] = safe;
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
  if (!data) return;
  NSString *path = [self usageLogPath];
  NSFileManager *fm = [NSFileManager defaultManager];
  NSDictionary *attrs = [fm attributesOfItemAtPath:path error:nil];
  if ([attrs[NSFileSize] unsignedLongLongValue] > 16 * 1024 * 1024) {
    NSString *rotated = [path stringByAppendingString:@".1"];
    [fm removeItemAtPath:rotated error:nil];
    [fm moveItemAtPath:path toPath:rotated error:nil];
  }
  if (![fm fileExistsAtPath:path]) [fm createFileAtPath:path contents:nil attributes:nil];
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!handle) return;
  [handle seekToEndOfFile];
  [handle writeData:data];
  [handle writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
  [handle closeFile];
}

- (void)runWebhookAction:(NSString *)action {
  NSString *resource = NSBundle.mainBundle.resourcePath;
  NSString *node = [resource stringByAppendingPathComponent:@"node"];
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:node]) node = [self findTool:@"node" paths:[self searchPaths]];
  if (!node) { [self alert:@"Webhook tool unavailable" info:@"The bundled Node.js runtime is missing."]; return; }
  NSString *configPath = self.configPath ?: @"";
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:node];
    task.arguments = @[[resource stringByAppendingPathComponent:@"tools/webhooks.js"], action];
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    if (configPath.length) environment[@"CLIPSPIKE_CONFIG"] = configPath;
    task.environment = environment;
    NSPipe *output = [NSPipe pipe];
    task.standardOutput = output;
    NSError *error = nil;
    NSDictionary *result = nil;
    if ([task launchAndReturnError:&error]) {
      NSData *data = [output.fileHandleForReading readDataToEndOfFile];
      [task waitUntilExit];
      id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
      if ([json isKindOfClass:[NSDictionary class]]) result = json;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!result || result[@"error"]) {
        [self alert:@"Webhook request failed" info:result[@"error"] ?: error.localizedDescription ?: @"The webhook helper returned no result."];
        return;
      }
      if ([action isEqualToString:@"test"]) {
        NSDictionary *entry = result[@"entry"];
        [self alert:[entry[@"ok"] boolValue] ? @"Webhook test delivered" : @"Webhook test failed"
               info:entry[@"error"] ?: @"The endpoint accepted the test event."];
        return;
      }
      NSArray *entries = result[@"entries"];
      NSMutableArray<NSString *> *lines = [NSMutableArray array];
      for (NSDictionary *entry in entries) {
        if (lines.count >= 10) break;
        [lines addObject:[NSString stringWithFormat:@"%@ · %@ · %@", entry[@"at"], entry[@"event"],
                          [entry[@"ok"] boolValue] ? @"Delivered" : entry[@"error"] ?: @"Failed"]];
      }
      [self alert:@"Recent webhook deliveries" info:lines.count ? [lines componentsJoinedByString:@"\n"] : @"No deliveries yet."];
    });
  });
}

- (void)showWebhookSettings:(id)sender {
  NSMutableDictionary *config = [self loadConfig];
  if (!config) { [self alert:@"Webhook settings unavailable" info:@"The configuration file could not be read."]; return; }
  NSDictionary *current = [config[@"webhook"] isKindOfClass:[NSDictionary class]] ? config[@"webhook"] : @{};
  NSTextField *endpoint = [NSTextField textFieldWithString:[current[@"url"] isKindOfClass:[NSString class]] ? current[@"url"] : @""];
  endpoint.placeholderString = @"https://…";
  NSSecureTextField *key = [NSSecureTextField new];
  key.placeholderString = [current[@"useKey"] boolValue] ? @"Key saved" : @"Optional";
  NSButton *enabled = [NSButton checkboxWithTitle:@"Send clip events" target:nil action:nil];
  enabled.state = [current[@"enabled"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
  NSButton *remove = [NSButton checkboxWithTitle:@"Remove saved key" target:nil action:nil];
  NSStackView *fields = [NSStackView stackViewWithViews:@[[NSTextField labelWithString:@"HTTPS endpoint"], endpoint,
    [NSTextField labelWithString:@"Bearer key"], key, enabled, remove]];
  fields.orientation = NSUserInterfaceLayoutOrientationVertical;
  fields.alignment = NSLayoutAttributeLeading;
  [endpoint.widthAnchor constraintEqualToConstant:340].active = YES;
  [key.widthAnchor constraintEqualToAnchor:endpoint.widthAnchor].active = YES;
  NSAlert *dialog = [NSAlert new];
  dialog.messageText = @"Clip Webhooks";
  dialog.informativeText = @"Clip events can include a local file URL. Use an endpoint you control.";
  fields.frame = (NSRect){NSZeroPoint, fields.fittingSize};
  dialog.accessoryView = fields;
  [dialog addButtonWithTitle:@"Save"];
  [dialog addButtonWithTitle:@"Cancel"];
  [dialog addButtonWithTitle:@"Save and Test"];
  [dialog addButtonWithTitle:@"Delivery Log"];
  NSModalResponse result = [dialog runModal];
  if (result == NSAlertThirdButtonReturn + 1) { [self runWebhookAction:@"log"]; return; }
  if (result != NSAlertFirstButtonReturn && result != NSAlertThirdButtonReturn) return;

  NSString *url = [endpoint.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSURLComponents *parts = [NSURLComponents componentsWithString:url];
  if ((url.length || enabled.state == NSControlStateValueOn || result == NSAlertThirdButtonReturn) &&
      (!parts.host.length || ![parts.scheme.lowercaseString isEqualToString:@"https"] || parts.user || parts.password || parts.fragment)) {
    [self alert:@"Invalid webhook endpoint" info:@"Enter a full HTTPS URL without embedded credentials or a fragment."];
    return;
  }
  NSString *value = key.stringValue;
  if (value.length && [value rangeOfString:@"^[!-~]{1,512}$" options:NSRegularExpressionSearch].location == NSNotFound) {
    [self alert:@"Invalid webhook key" info:@"Use 1–512 visible ASCII characters."];
    return;
  }
  BOOL useKey = value.length || (remove.state != NSControlStateValueOn && [current[@"useKey"] boolValue]);
  if (value.length && !url.length) {
    [self alert:@"Webhook endpoint required" info:@"Enter the HTTPS endpoint before saving its key."];
    return;
  }
  if ([current[@"useKey"] boolValue] && ![current[@"url"] isEqual:url] && !value.length && remove.state != NSControlStateValueOn) {
    [self alert:@"Webhook key required" info:@"Enter a key for the new endpoint or remove the existing key."];
    return;
  }
  NSData *keyData = value.length ? [NSJSONSerialization dataWithJSONObject:@{@"url": url, @"key": value} options:0 error:nil] : nil;
  NSString *credential = keyData ? [[NSString alloc] initWithData:keyData encoding:NSUTF8StringEncoding] : nil;
  if (value.length && !HDKeychainSet(@"webhook.key", credential)) {
    [self alert:@"Could not save webhook key" info:@"Check Keychain access and try again."];
    return;
  }
  config[@"webhook"] = @{@"url": url, @"enabled": @(enabled.state == NSControlStateValueOn), @"useKey": @(useKey)};
  if (![self writeConfig:config]) { [self alert:@"Could not save webhook settings" info:@"Check permissions on the configuration file."]; return; }
  if (!useKey) HDKeychainDelete(@"webhook.key");
  if (result == NSAlertThirdButtonReturn) [self runWebhookAction:@"test"];
}

- (void)changeSpikeSensitivity:(NSSlider *)sender {
  NSMutableDictionary *config = [self loadConfig];
  NSDictionary *saved = [config[@"app"] isKindOfClass:[NSDictionary class]] ? config[@"app"] : @{};
  NSNumber *previous = [saved[@"sensitivity"] isKindOfClass:[NSNumber class]] ? saved[@"sensitivity"] : @1;
  NSMutableDictionary *app = [saved mutableCopy];
  double value = round(sender.doubleValue * 20.0) / 20.0;
  app[@"sensitivity"] = @(value);
  config[@"app"] = app;
  if (![self writeConfig:config]) {
    [self.ui setSpikeSensitivity:previous.doubleValue];
    [self alert:@"Could not save sensitivity" info:@"Check permissions on the configuration file."];
    return;
  }
  [self.ui setSpikeSensitivity:value];
}

- (void)openPreferences:(id)sender { [self.ui selectPage:HDPageSettings]; }

- (void)uiPageSelected:(NSNumber *)page {
  NSArray *names = @[@"capture", @"clips", @"storage", @"license", @"settings"];
  NSInteger index = page.integerValue;
  [self logUsageEvent:@"page-view" details:@{@"page": index >= 0 && index < names.count ? names[index] : @"unknown"}];
}

- (void)activateLicense:(id)sender {
  if (self.licenseTask) return;
  NSString *key = [self.licenseKeyField.stringValue stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (!key.length) {
    [self alert:@"Enter a license key" info:@"Paste the key from your purchase email."];
    return;
  }
  self.licenseKeyField.stringValue = key;
  self.pendingLicenseKey = key;
  [self runLicenseAction:@"activate" silent:NO];
}

- (void)checkLicense:(id)sender {
  [self runLicenseAction:@"validate" silent:NO];
}

- (void)deactivateLicense:(id)sender {
  [self runLicenseAction:@"deactivate" silent:NO];
}

#pragma mark - Local feedback log (feedback.jsonl, read by tools/review-export.js)

- (NSString *)feedbackDirectory {
  return self.stateDir.length ? self.stateDir : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClipSpike"];
}

- (void)logFeedbackAction:(NSString *)action clipId:(NSString *)clipId details:(NSDictionary *)details {
  if (![clipId isKindOfClass:NSString.class] || !clipId.length || !action.length) return;
  NSDateFormatter *formatter = [NSDateFormatter new];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
  NSMutableDictionary *record = [@{@"v": @1, @"kind": @"clip-action", @"at": [formatter stringFromDate:NSDate.date], @"clipId": clipId, @"action": action, @"source": @"app"} mutableCopy];
  [record addEntriesFromDictionary:details ?: @{}];
  NSData *json = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
  if (!json) return;
  NSMutableData *line = [json mutableCopy];
  [line appendBytes:"\n" length:1];
  NSString *dir = [self feedbackDirectory];
  NSString *file = [dir stringByAppendingPathComponent:@"feedback.jsonl"];
  NSFileManager *manager = NSFileManager.defaultManager;
  [manager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:nil];
  if (![manager fileExistsAtPath:file]) [manager createFileAtPath:file contents:nil attributes:@{NSFilePosixPermissions: @0600}];
  int fd = open(file.fileSystemRepresentation, O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd < 0) return;
  (void)write(fd, line.bytes, line.length);
  close(fd);
}

- (void)logFeedbackAction:(NSString *)action clip:(NSDictionary *)entry {
  NSString *clipId = [entry[@"id"] isKindOfClass:NSString.class] ? entry[@"id"] : nil;
  [self logFeedbackAction:action clipId:clipId details:nil];
}

// Called by the Capture page's recent-clip buttons.
- (void)recentClipOpened:(NSDictionary *)entry { [self logFeedbackAction:@"opened" clip:entry]; }

- (NSInteger)ratingForClipId:(NSString *)clipId {
  if (!clipId.length) return 0;
  NSDictionary *ratings = [[NSUserDefaults standardUserDefaults] dictionaryForKey:@"clipRatings"];
  return [ratings[clipId] integerValue];
}

- (void)rateClipAtRow:(NSInteger)row value:(NSInteger)value {
  if (row < 0 || row >= (NSInteger)self.historyItems.count) return;
  NSDictionary *entry = self.historyItems[row];
  NSString *clipId = [entry[@"id"] isKindOfClass:NSString.class] ? entry[@"id"] : @"";
  if (!clipId.length) return;
  NSMutableDictionary *ratings = [[[NSUserDefaults standardUserDefaults] dictionaryForKey:@"clipRatings"] mutableCopy] ?: [NSMutableDictionary dictionary];
  NSInteger current = [ratings[clipId] integerValue];
  NSInteger next = current == value ? 0 : value; // clicking the same thumb again clears it
  if (next) ratings[clipId] = @(next); else [ratings removeObjectForKey:clipId];
  [[NSUserDefaults standardUserDefaults] setObject:ratings forKey:@"clipRatings"];
  [self logFeedbackAction:(next > 0 ? @"rated-up" : next < 0 ? @"rated-down" : @"rating-cleared") clip:entry];
  NSInteger column = [self.historyTable columnWithIdentifier:@"rating"];
  if (column >= 0) [self.historyTable reloadDataForRowIndexes:[NSIndexSet indexSetWithIndex:row] columnIndexes:[NSIndexSet indexSetWithIndex:column]];
}

- (void)rateClipUp:(NSButton *)sender { [self rateClipAtRow:sender.tag value:1]; }
- (void)rateClipDown:(NSButton *)sender { [self rateClipAtRow:sender.tag value:-1]; }

- (void)markClipFeedback:(NSString *)action {
  NSInteger row = self.historyTable.clickedRow >= 0 ? self.historyTable.clickedRow : self.historyTable.selectedRow;
  if (row < 0 || row >= (NSInteger)self.historyItems.count) return;
  [self logFeedbackAction:action clip:self.historyItems[row]];
  if ([action isEqualToString:@"duplicate"]) {
    NSString *clipId = self.historyItems[row][@"id"];
    if (clipId.length) {
      NSMutableDictionary *ratings = [[[NSUserDefaults standardUserDefaults] dictionaryForKey:@"clipRatings"] mutableCopy] ?: [NSMutableDictionary dictionary];
      ratings[clipId] = @(-1);
      [[NSUserDefaults standardUserDefaults] setObject:ratings forKey:@"clipRatings"];
      [self.historyTable reloadData];
    }
  }
  self.historyStatus.stringValue = [NSString stringWithFormat:@"Feedback saved: %@", [action stringByReplacingOccurrencesOfString:@"-" withString:@" "]];
}
- (void)markDuplicate:(id)sender { [self markClipFeedback:@"duplicate"]; }
- (void)markStartedLate:(id)sender { [self markClipFeedback:@"started-late"]; }
- (void)markEndedEarly:(id)sender { [self markClipFeedback:@"ended-early"]; }

#pragma mark - Capture monitoring

- (void)renderMonitoring {
  if (!self.monitorWindow) return;
  NSDictionary *snapshot = self.monitorSnapshot ?: @{};
  NSDictionary *window = [snapshot[@"lastWindow"] isKindOfClass:NSDictionary.class] ? snapshot[@"lastWindow"] : @{};
  BOOL active = self.task.running;
  self.monitorHealth.stringValue = [NSString stringWithFormat:@"%@ · %@ windows · %@ captures · %@ exports · %@ failures",
    active ? (snapshot[@"health"] ?: @"Starting") : @"Capture stopped",
    snapshot[@"windows"] ?: @0, snapshot[@"accepted"] ?: @0, snapshot[@"exported"] ?: @0, snapshot[@"failures"] ?: @0];
  self.monitorMissed.enabled = active && window.count > 0;
  NSMutableString *text = [NSMutableString stringWithFormat:@"CHAT & CAPTURE\nParticipants: %@   Reactions: %@   Messages: %@\nLast decision: %@\nVideo age: %.1f seconds   Dropped monitoring records: %@\n\n",
    window[@"participants"] ?: @0, window[@"reactions"] ?: @0, window[@"messages"] ?: @0,
    [window[@"accepted"] boolValue] ? @"Highlight captured" : window[@"suppression"] ?: [window[@"result"][@"reasons"] componentsJoinedByString:@"; "] ?: @"Waiting for chat",
    [window[@"frameAgeMs"] doubleValue] / 1000.0, snapshot[@"dropped"] ?: @0];
  NSDictionary *report = self.monitorReport;
  if (report) {
    self.monitorAuto.state = [report[@"autoTune"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    [text appendFormat:@"CHANNEL LEARNING\n#%@ · %@ rated clips across %@ completed live sessions\n%@ recorded windows\n\n",
      report[@"channel"] ?: @"", report[@"ratedClips"] ?: @0, report[@"ratedSessions"] ?: @0, report[@"windows"] ?: @0];
    if ([report[@"staged"] boolValue]) [text appendString:@"A validated change is staged for the next capture. This session stays unchanged.\n\n"];
    NSArray *reasons = [report[@"reasons"] isKindOfClass:NSArray.class] ? report[@"reasons"] : @[];
    for (NSString *reason in reasons) [text appendFormat:@"• %@\n", reason];
    NSDictionary *candidate = [report[@"candidate"] isKindOfClass:NSDictionary.class] ? report[@"candidate"] : nil;
    if (candidate) {
      NSDictionary *baseline = report[@"baseline"];
      [text appendFormat:@"\nCandidate: %@\nTraining score: %.2f → %.2f\nLater-session score: %.2f → %.2f\nGood moments retained in validation: %.0f%%\n",
        candidate[@"name"], [baseline[@"train"][@"utility"] doubleValue], [candidate[@"train"][@"utility"] doubleValue],
        [baseline[@"holdout"][@"utility"] doubleValue], [candidate[@"holdout"][@"utility"] doubleValue], [candidate[@"holdout"][@"goodRecall"] doubleValue] * 100];
    }
    NSDictionary *boundary = report[@"boundary"];
    [text appendFormat:@"\nBoundary feedback: %@ started late · %@ ended early\nMissed-moment markers: %@\n", boundary[@"started-late"] ?: @0, boundary[@"ended-early"] ?: @0, report[@"missed"] ?: @0];
  } else [text appendString:@"Learning report is loading. Capture several sessions and rate clips to build evidence.\n"];
  [text appendString:@"\nHOW TO TEACH IT\nUse thumbs up/down in Clips. Right-click a clip to mark Duplicate, Started Late, or Ended Early. Mark Missed Moment during live capture to record a timestamp; it does not recover video.\n\nOnly explicit good/bad/duplicate ratings train detection. Opening or uploading a clip never counts as quality. Boundary feedback is reported for review.\n\nAutomatic changes stay within narrow limits and apply on the next capture. Rollback restores the prior profile and pauses automatic tuning.\n\nAnalysis stays on this Mac. Replay uses observed recorder availability; unrated moments have unknown quality. No AI API or video upload is required.\n"];
  self.monitorText.string = text;
}

- (void)runMonitorCommand:(NSString *)option {
  if (self.monitorTask) return;
  NSString *name = [self.channel.stringValue.lowercaseString stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^([a-z0-9_]{1,25}|kick:[a-z0-9_-]{1,25}|(https?://)?(www\\.)?(twitch\\.tv/[a-z0-9_]{1,25}|kick\\.com/[a-z0-9_-]{1,25})/?)$" options:0 error:nil];
  if (![pattern firstMatchInString:name options:0 range:NSMakeRange(0, name.length)]) {
    self.monitorHealth.stringValue = @"Enter a Twitch username or Kick channel URL on Capture to view its learning report.";
    return;
  }
  NSString *resource = NSBundle.mainBundle.resourcePath;
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:[resource stringByAppendingPathComponent:@"node"]];
  NSMutableArray *args = [NSMutableArray arrayWithArray:@[[resource stringByAppendingPathComponent:@"tools/monitor.js"], name, @"--json"]];
  if (option.length) [args addObject:option];
  task.arguments = args;
  NSMutableDictionary *env = [NSProcessInfo.processInfo.environment mutableCopy];
  env[@"CLIPSPIKE_STATE"] = [self feedbackDirectory];
  env[@"CLIPSPIKE_KEYCHAIN"] = @"0";
  task.environment = env;
  NSPipe *pipe = NSPipe.pipe;
  task.standardOutput = pipe;
  task.standardError = [NSFileHandle fileHandleWithNullDevice];
  self.monitorTask = task;
  self.monitorAuto.enabled = NO;
  __weak typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSError *error = nil;
    BOOL launched = [task launchAndReturnError:&error];
    NSData *data = launched ? [pipe.fileHandleForReading readDataToEndOfFile] : nil;
    if (launched) [task waitUntilExit];
    NSDictionary *report = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      weakSelf.monitorTask = nil;
      weakSelf.monitorAuto.enabled = YES;
      if ([report isKindOfClass:NSDictionary.class]) {
        weakSelf.monitorReport = report;
        if (!weakSelf.task.running && [report[@"latest"] isKindOfClass:NSDictionary.class]) weakSelf.monitorSnapshot = report[@"latest"];
        [weakSelf renderMonitoring];
      } else weakSelf.monitorHealth.stringValue = error.localizedDescription ?: @"Could not read the report. Capture continues; try Refresh.";
    });
  });
}
- (void)refreshMonitoring:(id)sender { [self runMonitorCommand:nil]; }
- (void)toggleMonitorLearning:(NSButton *)sender { [self runMonitorCommand:sender.state == NSControlStateValueOn ? @"--resume" : @"--pause"]; }
- (void)rollbackMonitoring:(id)sender { [self runMonitorCommand:@"--rollback"]; }
- (void)syncMissedButton {
  BOOL ready = self.task.running && [self.monitorSnapshot[@"lastWindow"] isKindOfClass:[NSDictionary class]];
  self.ui.missedButton.enabled = ready;
}

- (void)markMissedMoment:(id)sender {
  if (!(self.task.running && [self.monitorSnapshot[@"lastWindow"] isKindOfClass:[NSDictionary class]])) {
    self.status.stringValue = self.task.running
      ? @"The video buffer is still filling. Try again in a few seconds."
      : @"Start a capture first.";
    return;
  }
  kill(self.task.processIdentifier, SIGUSR1);
  NSString *note = @"Marked this moment for review. It does not save a clip.";
  self.status.stringValue = note;
  if (self.monitorHealth) self.monitorHealth.stringValue = note;
}
- (void)showMonitoring:(id)sender {
  if (!self.monitorWindow) {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 760, 620)
      styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    window.title = @"Capture Monitor";
    window.releasedWhenClosed = NO;
    window.minSize = NSMakeSize(700, 500);
    self.monitorWindow = window;
    NSStackView *stack = [NSStackView new];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 12;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [window.contentView addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.leadingAnchor constraintEqualToAnchor:window.contentView.leadingAnchor constant:22],
      [stack.trailingAnchor constraintEqualToAnchor:window.contentView.trailingAnchor constant:-22],
      [stack.topAnchor constraintEqualToAnchor:window.contentView.topAnchor constant:22],
      [stack.bottomAnchor constraintEqualToAnchor:window.contentView.bottomAnchor constant:-22]
    ]];
    self.monitorHealth = [NSTextField wrappingLabelWithString:@"Loading monitoring…"];
    self.monitorHealth.font = [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
    [stack addArrangedSubview:self.monitorHealth];
    self.monitorAuto = [NSButton checkboxWithTitle:@"Apply validated tuning on the next capture" target:self action:@selector(toggleMonitorLearning:)];
    self.monitorAuto.state = NSControlStateValueOn;
    [stack addArrangedSubview:self.monitorAuto];
    NSStackView *actions = [NSStackView new]; actions.spacing = 8;
    [actions addArrangedSubview:[NSButton buttonWithTitle:@"Refresh Report" target:self action:@selector(refreshMonitoring:)]];
    self.monitorMissed = [NSButton buttonWithTitle:@"Mark missed moment" target:self action:@selector(markMissedMoment:)];
    [actions addArrangedSubview:self.monitorMissed];
    [actions addArrangedSubview:[NSButton buttonWithTitle:@"Rollback & Pause Tuning" target:self action:@selector(rollbackMonitoring:)]];
    [stack addArrangedSubview:actions];
    NSScrollView *scroll = [NSScrollView new];
    scroll.hasVerticalScroller = YES;
    scroll.borderType = NSBezelBorder;
    scroll.translatesAutoresizingMaskIntoConstraints = NO;
    self.monitorText = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 700, 420)];
    self.monitorText.editable = NO;
    self.monitorText.font = [NSFont systemFontOfSize:13];
    self.monitorText.textContainerInset = NSMakeSize(12, 12);
    self.monitorText.autoresizingMask = NSViewWidthSizable;
    self.monitorText.textContainer.widthTracksTextView = YES;
    scroll.documentView = self.monitorText;
    [stack addArrangedSubview:scroll];
    [scroll.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [scroll.heightAnchor constraintGreaterThanOrEqualToConstant:280].active = YES;
    [window center];
  }
  [self.monitorWindow makeKeyAndOrderFront:nil];
  [self renderMonitoring];
  [self refreshMonitoring:nil];
}

// Once per clip: a clip whose local file is gone (and wasn't removed by us
// after a confirmed upload) is logged as deleted.
- (void)logMissingClipFiles {
  NSString *dir = [self feedbackDirectory];
  NSData *data = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"history.json"]];
  NSArray *history = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![history isKindOfClass:NSArray.class]) return;
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSMutableSet *logged = [NSMutableSet setWithArray:[defaults arrayForKey:@"feedbackMissingLogged"] ?: @[]];
  NSUInteger before = logged.count;
  for (NSDictionary *entry in history) {
    if (![entry isKindOfClass:NSDictionary.class]) continue;
    NSString *clipId = [entry[@"id"] isKindOfClass:NSString.class] ? entry[@"id"] : nil;
    NSString *path = [entry[@"localPath"] isKindOfClass:NSString.class] ? entry[@"localPath"] : nil;
    if (!clipId.length || !path.length || [entry[@"deletedLocal"] boolValue] || [logged containsObject:clipId]) continue;
    if ([NSFileManager.defaultManager fileExistsAtPath:path]) continue;
    [self logFeedbackAction:@"deleted" clipId:clipId details:@{@"reason": @"missing-on-disk"}];
    [logged addObject:clipId];
  }
  if (logged.count != before) [defaults setObject:logged.allObjects forKey:@"feedbackMissingLogged"];
}

- (NSArray<NSDictionary *> *)historyRowsFromDisk {
  NSString *dir = self.stateDir.length ? self.stateDir : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClipSpike"];
  NSData *historyData = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"history.json"]];
  NSData *queueData = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"queue.json"]];
  NSArray *history = historyData ? [NSJSONSerialization JSONObjectWithData:historyData options:0 error:nil] : @[];
  NSArray *queue = queueData ? [NSJSONSerialization JSONObjectWithData:queueData options:0 error:nil] : @[];
  if (![history isKindOfClass:[NSArray class]]) history = @[];
  if (![queue isKindOfClass:[NSArray class]]) queue = @[];

  NSMutableArray<NSDictionary *> *rows = [NSMutableArray array];
  NSMutableSet<NSString *> *seen = [NSMutableSet set];
  for (NSDictionary *entry in history) {
    if (![entry isKindOfClass:[NSDictionary class]]) continue;
    [rows addObject:entry];
    if ([entry[@"id"] isKindOfClass:[NSString class]]) [seen addObject:entry[@"id"]];
  }
  for (NSDictionary *entry in queue) {
    if (![entry isKindOfClass:[NSDictionary class]]) continue;
    NSString *identifier = [entry[@"id"] isKindOfClass:[NSString class]] ? entry[@"id"] : @"";
    if (identifier.length && [seen containsObject:identifier]) continue;
    NSDictionary *metadata = [entry[@"metadata"] isKindOfClass:[NSDictionary class]] ? entry[@"metadata"] : nil;
    [rows addObject:@{
      @"id": identifier,
      @"createdAt": entry[@"createdAt"] ?: @"",
      @"reason": metadata[@"reason"] ?: @"Highlight",
      @"provider": entry[@"provider"] ?: @"",
      @"status": @"queued",
      @"localPath": entry[@"verticalPath"] ?: entry[@"rawPath"] ?: @"",
      @"remotePath": @"",
      @"webLink": @""
    }];
  }
  [rows sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [b[@"createdAt"] ?: @"" compare:a[@"createdAt"] ?: @""];
  }];

  if (self.ui) {
    NSString *query = self.ui.clipSearchField.stringValue.lowercaseString;
    NSInteger filter = self.ui.clipFilterControl.selectedSegment;
    NSMutableArray<NSDictionary *> *visible = [NSMutableArray array];
    for (NSDictionary *entry in rows) {
      NSString *provider = [entry[@"provider"] isKindOfClass:[NSString class]] ? entry[@"provider"] : @"";
      NSString *status = [entry[@"status"] isKindOfClass:[NSString class]] ? entry[@"status"] : @"";
      BOOL queued = [status isEqualToString:@"queued"];
      BOOL cloud = [provider isEqualToString:@"dropbox"] || [provider isEqualToString:@"googleDrive"];
      BOOL filterMatch = filter == 0
        || (filter == 1 && [provider isEqualToString:@"local"] && !queued)
        || (filter == 2 && cloud)
        || (filter == 3 && queued);
      if (!filterMatch) continue;
      if (query.length) {
        NSString *haystack = [[NSString stringWithFormat:@"%@ %@ %@ %@", entry[@"reason"] ?: @"", provider, entry[@"localPath"] ?: @"", entry[@"remotePath"] ?: @""] lowercaseString];
        if (![haystack containsString:query]) continue;
      }
      [visible addObject:entry];
    }
    rows = visible;
  }
  return rows;
}

- (void)updateHistoryStatus {
  NSInteger queued = self.queueItems.count;
  self.historyStatus.stringValue = [NSString stringWithFormat:@"%ld clip%@ in history · %ld queued for upload", (long)self.historyItems.count, self.historyItems.count == 1 ? @"" : @"s", (long)queued];
}

- (void)reloadHistoryFromDisk {
  NSString *dir = self.stateDir.length ? self.stateDir : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClipSpike"];
  NSData *queueData = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"queue.json"]];
  NSArray *queue = queueData ? [NSJSONSerialization JSONObjectWithData:queueData options:0 error:nil] : @[];
  self.queueItems = [queue isKindOfClass:[NSArray class]] ? [queue mutableCopy] : [NSMutableArray array];
  self.queuedCount = self.queueItems.count;
  NSInteger selectedRow = self.historyTable.selectedRow;
  NSString *selectedPath = (selectedRow >= 0 && selectedRow < (NSInteger)self.historyItems.count && [self.historyItems[selectedRow][@"localPath"] isKindOfClass:NSString.class]) ? self.historyItems[selectedRow][@"localPath"] : nil;
  self.historyItems = [[self historyRowsFromDisk] mutableCopy];
  NSArray *descriptors = self.historyTable.sortDescriptors;
  if (descriptors.count) [self.historyItems sortUsingDescriptors:descriptors];
  self.suppressPreviewUpdate = YES;
  [self.historyTable reloadData];
  if (selectedPath.length) {
    NSUInteger match = [self.historyItems indexOfObjectPassingTest:^BOOL(NSDictionary *item, NSUInteger idx, BOOL *stop) { return [item[@"localPath"] isEqual:selectedPath]; }];
    if (match != NSNotFound) [self.historyTable selectRowIndexes:[NSIndexSet indexSetWithIndex:match] byExtendingSelection:NO];
  }
  self.suppressPreviewUpdate = NO;
  [self tableViewSelectionDidChange:[NSNotification notificationWithName:NSTableViewSelectionDidChangeNotification object:self.historyTable]];
  [self.ui setLibraryEmpty:self.historyItems.count == 0];
  [self updateHistoryStatus];
  if (self.ui) {
    NSString *query = self.ui.clipSearchField.stringValue;
    NSInteger filter = self.ui.clipFilterControl.selectedSegment;
    self.ui.clipSearchField.stringValue = @"";
    self.ui.clipFilterControl.selectedSegment = 0;
    [self.ui updateRecentClips:[self recentClipCardEntries]];
    self.ui.clipSearchField.stringValue = query;
    self.ui.clipFilterControl.selectedSegment = filter;
  }
}

// The newest three history rows, enriched with the peak chatter count and top emotes
// stored in each clip's metadata sidecar, for the Capture page's portrait strip.
- (NSArray<NSDictionary *> *)recentClipCardEntries {
  NSArray<NSDictionary *> *rows = [self historyRowsFromDisk];
  NSMutableArray<NSDictionary *> *result = [NSMutableArray arrayWithCapacity:rows.count];
  [rows enumerateObjectsUsingBlock:^(NSDictionary *entry, NSUInteger index, BOOL *stop) {
    if (index >= 3) { [result addObject:entry]; return; }
    NSString *path = [entry[@"localPath"] isKindOfClass:NSString.class] ? entry[@"localPath"] : @"";
    NSDictionary *meta = [self metadataForClipPath:path];
    NSMutableDictionary *copy = [entry mutableCopy];
    NSNumber *participants = [meta[@"participants"] isKindOfClass:NSNumber.class] ? meta[@"participants"] : nil;
    NSNumber *messages = [meta[@"messages"] isKindOfClass:NSNumber.class] ? meta[@"messages"] : nil;
    if (participants.doubleValue > 0) copy[@"peak"] = participants;
    else if (messages.doubleValue > 0) copy[@"peak"] = messages;
    if ([meta[@"topEmotes"] isKindOfClass:NSArray.class]) copy[@"topEmotes"] = meta[@"topEmotes"];
    [result addObject:copy];
  }];
  return result;
}

- (void)showHistory:(id)sender {
  if (self.ui) { [self.ui selectPage:HDPageClips]; [self reloadHistoryFromDisk]; return; }
  if (!self.historyWindow) {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 780, 450)
                                                   styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"Clip History";
    window.releasedWhenClosed = NO;
    NSView *view = window.contentView;

    NSTextField *heading = [NSTextField labelWithString:@"Clip History"];
    heading.font = [NSFont boldSystemFontOfSize:20];
    heading.frame = NSMakeRect(24, 400, 400, 26);
    [view addSubview:heading];

    self.historyStatus = [NSTextField labelWithString:@""];
    self.historyStatus.font = [NSFont systemFontOfSize:11];
    self.historyStatus.textColor = [NSColor secondaryLabelColor];
    self.historyStatus.frame = NSMakeRect(24, 378, 732, 16);
    [view addSubview:self.historyStatus];

    NSTableView *table = [[NSTableView alloc] initWithFrame:NSMakeRect(0, 0, 732, 280)];
    table.dataSource = self;
    table.delegate = self;
    table.rowHeight = 24;
    table.usesAlternatingRowBackgroundColors = YES;
    table.doubleAction = @selector(openSelectedHistory:);
    table.target = self;
    NSArray *columns = @[
      @[@"preview", @"", @72.0],
      @[@"when", @"Timestamp", @160.0],
      @[@"chatrate", @"Peak", @72.0],
      @[@"size", @"Size", @78.0],
      @[@"provider", @"Cloud", @140.0],
      @[@"local", @"Local", @180.0],
      @[@"rating", @"", @64.0]
    ];
    for (NSArray *spec in columns) {
      NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:spec[0]];
      column.title = spec[1];
      column.width = [spec[2] doubleValue];
      [table addTableColumn:column];
    }
    self.historyTable = table;

    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(24, 84, 732, 280)];
    scroll.documentView = table;
    scroll.hasVerticalScroller = YES;
    scroll.autohidesScrollers = YES;
    scroll.borderType = NSBezelBorder;
    [view addSubview:scroll];

    self.historyOpenButton = [NSButton buttonWithTitle:@"Open Selected" target:self action:@selector(openSelectedHistory:)];
    self.historyOpenButton.frame = NSMakeRect(24, 40, 130, 32);
    self.historyOpenButton.enabled = NO;
    [view addSubview:self.historyOpenButton];

    NSButton *refresh = [NSButton buttonWithTitle:@"Refresh" target:self action:@selector(refreshHistory:)];
    refresh.frame = NSMakeRect(162, 40, 90, 32);
    [view addSubview:refresh];

    NSButton *folder = [NSButton buttonWithTitle:@"Open State Folder" target:self action:@selector(openStateFolder:)];
    folder.frame = NSMakeRect(260, 40, 150, 32);
    [view addSubview:folder];

    NSButton *close = [NSButton buttonWithTitle:@"Close" target:self action:@selector(closeHistory:)];
    close.frame = NSMakeRect(418, 40, 90, 32);
    [view addSubview:close];

    self.historyWindow = window;
    [window center];
  }
  [self reloadHistoryFromDisk];
  [self.historyWindow makeKeyAndOrderFront:nil];
}

- (void)closeHistory:(id)sender {
  [self.historyWindow close];
}

- (void)refreshHistory:(id)sender {
  [self reloadHistoryFromDisk];
}

- (void)openStateFolder:(id)sender {
  NSString *dir = self.stateDir.length ? self.stateDir : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClipSpike"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:dir]];
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)tableView {
  return self.historyItems.count;
}

- (NSView *)centeredHistoryLabel:(NSTextField *)label {
  NSTableCellView *cell = [NSTableCellView new]; label.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:label];
  [NSLayoutConstraint activateConstraints:@[
    [label.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:6],
    [label.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor constant:-6],
    [label.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor]
  ]];
  return cell;
}

- (NSDictionary *)metadataForClipPath:(NSString *)path {
  if (!path.length) return @{};
  if (!self.clipMetaCache) { self.clipMetaCache = [NSCache new]; self.clipMetaCache.countLimit = 200; }
  NSDictionary *cached = [self.clipMetaCache objectForKey:path];
  if (cached) return cached;
  NSString *sidecar = [[path stringByDeletingPathExtension] stringByAppendingPathExtension:@"json"];
  NSData *data = [NSData dataWithContentsOfFile:sidecar];
  id json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  NSDictionary *meta = [json isKindOfClass:NSDictionary.class] ? json : @{};
  [self.clipMetaCache setObject:meta forKey:path];
  return meta;
}

- (unsigned long long)byteCountForEntry:(NSDictionary *)entry path:(NSString *)path meta:(NSDictionary *)meta hasBytes:(BOOL *)hasBytes {
  if (path.length && [[NSFileManager defaultManager] fileExistsAtPath:path]) {
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    if (attrs) {
      if (hasBytes) *hasBytes = YES;
      return [attrs fileSize];
    }
  }
  for (NSString *key in @[@"bytes", @"size", @"byteSize"]) {
    if ([meta[key] isKindOfClass:NSNumber.class] && [meta[key] unsignedLongLongValue] > 0) {
      if (hasBytes) *hasBytes = YES;
      return [meta[key] unsignedLongLongValue];
    }
  }
  if (hasBytes) *hasBytes = NO;
  return 0;
}

- (NSView *)tableView:(NSTableView *)tableView viewForTableColumn:(NSTableColumn *)tableColumn row:(NSInteger)row {
  if (row < 0 || row >= (NSInteger)self.historyItems.count) return nil;
  NSDictionary *entry = self.historyItems[row];
  NSString *identifier = tableColumn.identifier;
  NSString *path = [entry[@"localPath"] isKindOfClass:NSString.class] ? entry[@"localPath"] : @"";
  NSString *reason = [entry[@"reason"] isKindOfClass:NSString.class] ? entry[@"reason"] : @"Highlight";
  NSDictionary *meta = [self metadataForClipPath:path];
  if ([identifier isEqualToString:@"preview"] || [identifier isEqualToString:@"reason"]) {
    NSTableCellView *cell = [NSTableCellView new];
    NSImage *previewImage = [self.clipPreviewCache objectForKey:path][@"image"];
    NSImageView *preview = [NSImageView new];
    preview.translatesAutoresizingMaskIntoConstraints = NO;
    preview.imageScaling = NSImageScaleProportionallyUpOrDown;
    preview.image = previewImage;
    preview.wantsLayer = YES;
    preview.layer.masksToBounds = YES;
    preview.layer.backgroundColor = [NSColor colorWithSRGBRed:0x18 / 255.0 green:0x18 / 255.0 blue:0x1B / 255.0 alpha:1].CGColor;
    preview.layer.borderWidth = 1;
    preview.layer.borderColor = [NSColor colorWithSRGBRed:0x27 / 255.0 green:0x27 / 255.0 blue:0x2A / 255.0 alpha:1].CGColor;
    [cell addSubview:preview];
    [NSLayoutConstraint activateConstraints:@[
      [preview.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:8],
      [preview.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
      [preview.widthAnchor constraintEqualToConstant:56],
      [preview.heightAnchor constraintEqualToConstant:32]
    ]];
    if ([identifier isEqualToString:@"reason"]) {
      NSTextField *title = [NSTextField labelWithString:reason];
      title.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
      title.lineBreakMode = NSLineBreakByTruncatingTail;
      title.translatesAutoresizingMaskIntoConstraints = NO;
      [cell addSubview:title];
      [NSLayoutConstraint activateConstraints:@[
        [title.leadingAnchor constraintEqualToAnchor:preview.trailingAnchor constant:8],
        [title.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor constant:-6],
        [title.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor]
      ]];
    }
    cell.toolTip = [NSString stringWithFormat:@"%@\n%@", reason, path];
    if (path.length) [self requestClipPreview:path];
    return cell;
  }
  if ([identifier isEqualToString:@"when"]) {
    NSString *raw = [entry[@"createdAt"] isKindOfClass:NSString.class] ? entry[@"createdAt"] : @"";
    NSDateFormatter *parser = [NSDateFormatter new];
    parser.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    parser.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
    parser.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX";
    NSDate *date = [parser dateFromString:raw];
    if (!date) {
      parser.dateFormat = @"yyyy-MM-dd'T'HH:mm:ssXXXXX";
      date = [parser dateFromString:raw];
    }
    NSDateFormatter *display = [NSDateFormatter new];
    display.locale = NSLocale.currentLocale;
    display.timeZone = [NSTimeZone localTimeZone];
    [display setLocalizedDateFormatFromTemplate:@"MMM d jm"];
    NSTextField *label = [NSTextField labelWithString:date ? [display stringFromDate:date] : (raw.length ? raw : @"—")];
    label.font = HDDeskMono(11);
    label.lineBreakMode = NSLineBreakByTruncatingTail;
    label.toolTip = [NSString stringWithFormat:@"%@\n%@", raw, reason];
    return [self centeredHistoryLabel:label];
  }
  if ([identifier isEqualToString:@"chatrate"]) {
    NSNumber *participants = [meta[@"participants"] isKindOfClass:NSNumber.class] ? meta[@"participants"] : nil;
    NSNumber *score = [meta[@"score"] isKindOfClass:NSNumber.class] ? meta[@"score"] : nil;
    NSNumber *messages = [meta[@"messages"] isKindOfClass:NSNumber.class] ? meta[@"messages"] : nil;
    NSString *peak = @"—";
    if (participants.doubleValue > 0) peak = [NSString stringWithFormat:@"%.0f", participants.doubleValue];
    else if (messages.doubleValue > 0) peak = [NSString stringWithFormat:@"%.0f", messages.doubleValue];
    else if (score.doubleValue > 0) peak = [NSString stringWithFormat:@"%.1f", score.doubleValue];
    NSTextField *label = [NSTextField labelWithString:peak];
    label.font = HDDeskMono(11);
    label.toolTip = participants ? [NSString stringWithFormat:@"Peak chatters %@", peak] : reason;
    return [self centeredHistoryLabel:label];
  }
  BOOL hasBytes = NO;
  unsigned long long bytes = [self byteCountForEntry:entry path:path meta:meta hasBytes:&hasBytes];
  if ([identifier isEqualToString:@"size"]) {
    NSTextField *label = [NSTextField labelWithString:hasBytes ? HDByteString(bytes) : @"—"];
    label.font = HDDeskMono(11);
    label.toolTip = path;
    return [self centeredHistoryLabel:label];
  }
  if ([identifier isEqualToString:@"local"]) {
    BOOL deleted = [entry[@"deletedLocal"] boolValue];
    NSString *text = deleted
      ? (hasBytes ? [NSString stringWithFormat:@"Local deleted · %@ freed", HDByteString(bytes)] : @"Local deleted")
      : (path.length && [[NSFileManager defaultManager] fileExistsAtPath:path] ? @"On disk" : @"No local file");
    NSTextField *label = [NSTextField labelWithString:text];
    label.font = HDDeskMono(11);
    label.lineBreakMode = NSLineBreakByTruncatingMiddle;
    label.toolTip = path.length ? path : text;
    return [self centeredHistoryLabel:label];
  }
  if ([identifier isEqualToString:@"provider"] || [identifier isEqualToString:@"status"]) {
    NSString *provider = [entry[@"provider"] isKindOfClass:NSString.class] ? entry[@"provider"] : @"";
    NSString *status = [identifier isEqualToString:@"status"]
      ? ([entry[@"status"] isKindOfClass:NSString.class] ? entry[@"status"] : @"")
      : ([entry[@"status"] isKindOfClass:NSString.class] ? entry[@"status"] : @"");
    NSString *name = [provider isEqualToString:@"googleDrive"] ? @"Drive" : [provider isEqualToString:@"dropbox"] ? @"Dropbox" : [provider isEqualToString:@"local"] ? @"Local" : (provider.length ? provider : @"Local");
    NSString *state = @"Saved";
    if ([status isEqualToString:@"uploaded"]) state = @"Synced";
    else if ([status isEqualToString:@"queued"] || [status isEqualToString:@"pending"]) state = @"Queued";
    else if ([status isEqualToString:@"uploading"]) state = @"Uploading";
    else if ([status.lowercaseString containsString:@"failed"] || [status.lowercaseString containsString:@"error"]) state = @"Failed";
    NSString *badge = [identifier isEqualToString:@"status"] ? status.capitalizedString : [NSString stringWithFormat:@"%@ · %@", name, state];
    NSColor *color = [provider isEqualToString:@"local"] || !provider.length
      ? NSColor.secondaryLabelColor
      : HDSymbolColorForStatus(status);
    NSTextField *providerLabel = [NSTextField labelWithString:@""];
    providerLabel.attributedStringValue = HDSymbolAttributedString([identifier isEqualToString:@"status"] ? HDSymbolRoleForStatus(status) : HDSymbolRoleForProvider(provider), 12, color, badge);
    providerLabel.toolTip = [NSString stringWithFormat:@"%@\n%@", badge, [entry[@"remotePath"] isKindOfClass:NSString.class] ? entry[@"remotePath"] : path];
    return [self centeredHistoryLabel:providerLabel];
  }
  if ([identifier isEqualToString:@"rating"]) {
    NSString *clipId = [entry[@"id"] isKindOfClass:NSString.class] ? entry[@"id"] : @"";
    NSInteger rating = [self ratingForClipId:clipId];
    NSStackView *buttons = [NSStackView new];
    buttons.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    buttons.spacing = 2;
    NSArray *specs = @[@[@"hand.thumbsup", @"Good clip", @1, NSStringFromSelector(@selector(rateClipUp:))], @[@"hand.thumbsdown", @"Not a good clip", @-1, NSStringFromSelector(@selector(rateClipDown:))]];
    for (NSArray *spec in specs) {
      BOOL active = rating == [spec[2] integerValue];
      NSString *symbol = active ? [spec[0] stringByAppendingString:@".fill"] : spec[0];
      NSButton *button = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:symbol accessibilityDescription:spec[1]] target:self action:NSSelectorFromString(spec[3])];
      button.bordered = NO;
      button.tag = row;
      button.toolTip = spec[1];
      button.contentTintColor = active
        ? NSColor.labelColor
        : NSColor.secondaryLabelColor;
      button.enabled = clipId.length > 0;
      [buttons addArrangedSubview:button];
    }
    NSTableCellView *cell = [NSTableCellView new];
    buttons.translatesAutoresizingMaskIntoConstraints = NO;
    [cell addSubview:buttons];
    [NSLayoutConstraint activateConstraints:@[
      [buttons.centerXAnchor constraintEqualToAnchor:cell.centerXAnchor],
      [buttons.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor]
    ]];
    return cell;
  }
  NSString *value = [identifier isEqualToString:@"path"]
    ? (([entry[@"remotePath"] isKindOfClass:NSString.class] && [entry[@"remotePath"] length]) ? entry[@"remotePath"] : path)
    : @"";
  NSTextField *label = [NSTextField labelWithString:value ?: @""];
  label.font = HDDeskMono(11);
  label.lineBreakMode = NSLineBreakByTruncatingMiddle;
  label.toolTip = path.length ? path : value;
  return [self centeredHistoryLabel:label];
}

- (NSImage *)cachedClipPreview:(NSString *)path {
  [self requestClipPreview:path];
  return [self.clipPreviewCache objectForKey:path][@"image"];
}

- (void)requestClipPreview:(NSString *)path {
  if (!path.length || ![[NSFileManager defaultManager] fileExistsAtPath:path]) return;
  if (!self.clipPreviewCache) { self.clipPreviewCache = [NSCache new]; self.clipPreviewCache.countLimit = 100; }
  if (!self.pendingClipPreviews) self.pendingClipPreviews = [NSMutableSet set];
  if ([self.clipPreviewCache objectForKey:path] || [self.pendingClipPreviews containsObject:path]) return;
  [self.pendingClipPreviews addObject:path];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
    AVAssetImageGenerator *generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
    generator.appliesPreferredTrackTransform = YES; generator.maximumSize = CGSizeMake(360,640);
    [generator generateCGImageAsynchronouslyForTime:kCMTimeZero completionHandler:^(CGImageRef cg, CMTime actual, NSError *error) {
      NSImage *image = cg ? [[NSImage alloc] initWithCGImage:cg size:NSZeroSize] : nil;
      NSDictionary *result = image ? @{@"image":image} : @{};
      dispatch_async(dispatch_get_main_queue(), ^{
        [self.clipPreviewCache setObject:result forKey:path];
        [self.pendingClipPreviews removeObject:path];
        [self.historyTable reloadDataForRowIndexes:[NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0,self.historyItems.count)] columnIndexes:[NSIndexSet indexSetWithIndex:0]];
        [self.ui refreshRecentPreviews];
      });
    }];
  });
}

- (void)tableView:(NSTableView *)tableView sortDescriptorsDidChange:(NSArray<NSSortDescriptor *> *)oldDescriptors {
  [self.historyItems sortUsingDescriptors:tableView.sortDescriptors];
  [tableView reloadData];
}

- (NSDictionary *)contextClip {
  NSInteger row = self.historyTable.clickedRow >= 0 ? self.historyTable.clickedRow : self.historyTable.selectedRow;
  return row >= 0 && row < self.historyItems.count ? self.historyItems[row] : nil;
}

- (void)revealSelectedClip:(id)sender {
  NSDictionary *entry = [self contextClip]; NSString *path = entry[@"localPath"];
  if (path.length && [[NSFileManager defaultManager] fileExistsAtPath:path]) {
    [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[[NSURL fileURLWithPath:path]]];
    [self logFeedbackAction:@"revealed" clip:entry];
  }
  else [self alert:@"No local file" info:@"This clip may be stored in the cloud. Open it from the library to view the cloud copy."];
}

- (void)copySelectedClipLink:(id)sender {
  NSString *link = [self contextClip][@"webLink"];
  if (!link.length) { [self alert:@"No cloud link" info:@"This clip does not have a saved cloud link."]; return; }
  [NSPasteboard.generalPasteboard clearContents]; [NSPasteboard.generalPasteboard setString:link forType:NSPasteboardTypeString];
}

- (void)showSelectedClipDetails:(id)sender {
  NSDictionary *entry = [self contextClip]; if (!entry) return;
  [self alert:entry[@"reason"] ?: @"Clip details" info:[NSString stringWithFormat:@"Created: %@\nStatus: %@\nStorage: %@\n\nLocal file:\n%@\n\nCloud location:\n%@", entry[@"createdAt"] ?: @"Unknown", entry[@"status"] ?: @"Unknown", entry[@"provider"] ?: @"Local", entry[@"localPath"] ?: @"None", entry[@"remotePath"] ?: entry[@"webLink"] ?: @"None"]];
}

- (void)tableViewSelectionDidChange:(NSNotification *)notification {
  self.historyOpenButton.enabled = self.historyTable.selectedRow >= 0;
  if (self.suppressPreviewUpdate) return;
  NSInteger row = self.historyTable.selectedRow;
  [self.ui showClipPreviewForEntry:(row >= 0 && row < (NSInteger)self.historyItems.count) ? self.historyItems[row] : nil];
}

- (void)openSelectedHistory:(id)sender {
  NSInteger row = ([sender isKindOfClass:NSMenuItem.class] && self.historyTable.clickedRow >= 0) ? self.historyTable.clickedRow : self.historyTable.selectedRow;
  if (row < 0 || row >= (NSInteger)self.historyItems.count) return;
  NSDictionary *entry = self.historyItems[row];
  NSString *localPath = [entry[@"localPath"] isKindOfClass:[NSString class]] ? entry[@"localPath"] : @"";
  NSString *webLink = [entry[@"webLink"] isKindOfClass:[NSString class]] ? entry[@"webLink"] : @"";
  NSString *provider = [entry[@"provider"] isKindOfClass:[NSString class]] ? entry[@"provider"] : @"";
  [self logFeedbackAction:@"opened" clip:entry];
  if (localPath.length && [[NSFileManager defaultManager] fileExistsAtPath:localPath]) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:localPath]];
  } else if (webLink.length) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:webLink]];
  } else if ([provider isEqualToString:@"dropbox"]) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kDropboxHomeURL]];
  } else if ([provider isEqualToString:@"googleDrive"]) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kGoogleDriveHomeURL]];
  } else {
    [self alert:@"Nothing to open" info:@"This clip has no local file or remote link."];
  }
}

- (void)updateNotificationsMenu {
  self.ui.notificationsCheckbox.state = (self.notificationsEnabled && self.notificationsAuthorized) ? NSControlStateValueOn : NSControlStateValueOff;
  if (!self.notificationsMenuItem) return;
  self.notificationsMenuItem.state = (self.notificationsEnabled && self.notificationsAuthorized) ? NSControlStateValueOn : NSControlStateValueOff;
}

- (void)setupNotifications {
  NSString *env = HDEnv(@"CLIPSPIKE_NOTIFICATIONS");
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  if (env.length) {
    self.notificationsEnabled = ![env isEqualToString:@"0"];
  } else if ([defaults objectForKey:@"HDNotificationsEnabled"] == nil) {
    self.notificationsEnabled = YES;
  } else {
    self.notificationsEnabled = [defaults boolForKey:@"HDNotificationsEnabled"];
  }
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  __weak typeof(self) weakSelf = self;
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    dispatch_async(dispatch_get_main_queue(), ^{
      weakSelf.notificationsAuthorized = settings.authorizationStatus == UNAuthorizationStatusAuthorized;
      [weakSelf updateNotificationsMenu];
      if (weakSelf.notificationsEnabled && settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
        [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                              completionHandler:^(BOOL granted, NSError *error) {
          dispatch_async(dispatch_get_main_queue(), ^{
            weakSelf.notificationsAuthorized = granted;
            [weakSelf updateNotificationsMenu];
            if (!granted && error) weakSelf.lastError = error.localizedDescription;
          });
        }];
      }
    });
  }];
}

- (void)toggleNotifications:(id)sender {
  self.notificationsEnabled = !self.notificationsEnabled;
  [[NSUserDefaults standardUserDefaults] setBool:self.notificationsEnabled forKey:@"HDNotificationsEnabled"];
  [self updateNotificationsMenu];
  if (self.notificationsEnabled) [self setupNotifications];
}

- (void)notifyTitle:(NSString *)title body:(NSString *)body {
  if (!self.notificationsEnabled || !self.notificationsAuthorized) return;
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = title ?: @"ClipSpike";
  content.body = body ?: @"";
  content.sound = [UNNotificationSound defaultSound];
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:NSUUID.UUID.UUIDString content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:nil];
}

- (void)appendLogLine:(NSString *)line {
  if (!self.logLines) self.logLines = [NSMutableArray array];
  NSDateFormatter *formatter = [NSDateFormatter new];
  formatter.dateFormat = @"yyyy-MM-dd HH:mm:ss";
  [self.logLines addObject:[NSString stringWithFormat:@"%@  %@", [formatter stringFromDate:[NSDate date]], line ?: @""]];
  while (self.logLines.count > 1000) [self.logLines removeObjectAtIndex:0];
}

- (NSString *)runDiagnosticCommand:(NSString *)path arguments:(NSArray<NSString *> *)arguments {
  if (!path.length || ![[NSFileManager defaultManager] isExecutableFileAtPath:path]) return @"unavailable";
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:path];
  task.arguments = arguments ?: @[];
  NSPipe *pipe = [NSPipe pipe];
  task.standardOutput = pipe;
  task.standardError = pipe;
  @try {
    if (![task launchAndReturnError:nil]) return @"launch failed";
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    return text.length > 8000 ? [text substringToIndex:8000] : text;
  } @catch (NSException *exception) {
    return [NSString stringWithFormat:@"error: %@", exception.reason ?: @"unknown"];
  }
}

- (id)sanitizeDiagnosticObject:(id)object {
  if ([object isKindOfClass:[NSDictionary class]]) {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    for (NSString *key in (NSDictionary *)object) {
      id value = ((NSDictionary *)object)[key];
      NSString *lower = key.lowercaseString;
      BOOL sensitive = [lower containsString:@"token"] || [lower containsString:@"secret"] || [lower containsString:@"password"] || [lower containsString:@"private"] || [lower isEqualToString:@"webhook"] || [lower isEqualToString:@"key"] || [lower isEqualToString:@"instance"];
      if (sensitive && value && ![value isKindOfClass:[NSNull class]] && (![value isKindOfClass:[NSString class]] || [value length] > 0)) {
        result[key] = @"<redacted>";
      } else {
        result[key] = [self sanitizeDiagnosticObject:value];
      }
    }
    return result;
  }
  if ([object isKindOfClass:[NSArray class]]) {
    NSMutableArray *result = [NSMutableArray array];
    for (id value in (NSArray *)object) [result addObject:[self sanitizeDiagnosticObject:value]];
    return result;
  }
  return object ?: @"";
}

- (void)exportDiagnostics:(id)sender {
  NSSavePanel *panel = [NSSavePanel savePanel];
  NSDateFormatter *stamp = [NSDateFormatter new];
  stamp.dateFormat = @"yyyyMMdd-HHmm";
  panel.nameFieldStringValue = [NSString stringWithFormat:@"ClipSpike-Diagnostics-%@.zip", [stamp stringFromDate:[NSDate date]]];
  panel.allowedContentTypes = @[[UTType typeWithFilenameExtension:@"zip"]];
  panel.canCreateDirectories = YES;
  [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
    if (response != NSModalResponseOK || !panel.URL) return;
    NSString *temp = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"ClipSpike-Diagnostics-%@", NSUUID.UUID.UUIDString]];
    NSFileManager *fm = [NSFileManager defaultManager];
    [fm createDirectoryAtPath:temp withIntermediateDirectories:YES attributes:nil error:nil];

    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[@"appVersion"] = NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"] ?: @"?";
    info[@"appBuild"] = NSBundle.mainBundle.infoDictionary[@"CFBundleVersion"] ?: @"?";
    info[@"macOS"] = NSProcessInfo.processInfo.operatingSystemVersionString ?: @"?";
#if defined(__arm64__)
    info[@"architecture"] = @"arm64";
#elif defined(__x86_64__)
    info[@"architecture"] = @"x86_64";
#else
    info[@"architecture"] = @"unknown";
#endif
    info[@"storageMode"] = self.storageMode ?: @"?";
    info[@"storageLabel"] = self.storageLabel ?: @"?";
    info[@"storageConfigured"] = @(self.storageConfigured);
    info[@"licenseRequired"] = @(self.licenseRequired);
    info[@"licenseValid"] = @(self.licenseValid);
    info[@"trialDaysLeft"] = @([self licenseTrialDaysLeft]);
    info[@"stateDir"] = self.stateDir ?: @"";
    info[@"configPath"] = self.configPath ?: @"";
    info[@"outputPath"] = self.outputPath ?: @"";
    info[@"queuedUploads"] = @(self.queuedCount);
    info[@"clipCount"] = @(self.clipCount);
    info[@"lastError"] = self.lastError ?: @"";

    NSData *infoData = [NSJSONSerialization dataWithJSONObject:info options:NSJSONWritingPrettyPrinted error:nil];
    if (infoData) [infoData writeToFile:[temp stringByAppendingPathComponent:@"summary.json"] atomically:YES];

    NSMutableDictionary *config = [self loadConfig];
    id sanitized = [self sanitizeDiagnosticObject:config ?: @{}];
    NSData *configData = [NSJSONSerialization dataWithJSONObject:sanitized options:NSJSONWritingPrettyPrinted error:nil];
    if (configData) [configData writeToFile:[temp stringByAppendingPathComponent:@"config-redacted.json"] atomically:YES];

    for (NSString *name in @[@"queue.json", @"history.json"]) {
      NSString *source = [self.stateDir stringByAppendingPathComponent:name];
      if ([fm fileExistsAtPath:source]) [fm copyItemAtPath:source toPath:[temp stringByAppendingPathComponent:name] error:nil];
    }

    NSString *crashSource = [self.stateDir stringByAppendingPathComponent:@"crashes"];
    if ([fm fileExistsAtPath:crashSource]) [fm copyItemAtPath:crashSource toPath:[temp stringByAppendingPathComponent:@"crashes"] error:nil];

    NSString *log = [[self.logLines componentsJoinedByString:@"\n"] stringByAppendingString:@"\n"];
    [log writeToFile:[temp stringByAppendingPathComponent:@"app.log"] atomically:YES encoding:NSUTF8StringEncoding error:nil];

    NSMutableArray<NSString *> *runtime = [NSMutableArray array];
    NSString *runtimeBin = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"runtime/bin"];
    [runtime addObject:[NSString stringWithFormat:@"ffmpeg:\n%@", [self runDiagnosticCommand:[runtimeBin stringByAppendingPathComponent:@"ffmpeg"] arguments:@[@"-version"]]]];
    [runtime addObject:[NSString stringWithFormat:@"streamlink:\n%@", [self runDiagnosticCommand:[runtimeBin stringByAppendingPathComponent:@"streamlink"] arguments:@[@"--version"]]]];
    [runtime addObject:[NSString stringWithFormat:@"node:\n%@", [self runDiagnosticCommand:[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"node"] arguments:@[@"--version"]]]];
    [runtime addObject:[NSString stringWithFormat:@"sw_vers:\n%@", [self runDiagnosticCommand:@"/usr/bin/sw_vers" arguments:@[]]]];
    [runtime addObject:[NSString stringWithFormat:@"uname:\n%@", [self runDiagnosticCommand:@"/usr/bin/uname" arguments:@[@"-m"]]]];
    [runtime addObject:[NSString stringWithFormat:@"codesign:\n%@", [self runDiagnosticCommand:@"/usr/bin/codesign" arguments:@[@"-dv", @"--verbose=2", NSBundle.mainBundle.bundlePath]]]];
    [[runtime componentsJoinedByString:@"\n\n"] writeToFile:[temp stringByAppendingPathComponent:@"runtime.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];

    NSString *readme = @"ClipSpike diagnostics\n\nThis archive may contain local paths, clip history, and error logs. Review it before sharing.\nOAuth tokens, app secrets, and license keys are redacted from config-redacted.json.\n\nSend this zip with a short description of what happened.\n";
    [readme writeToFile:[temp stringByAppendingPathComponent:@"README.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];

    NSString *zip = panel.URL.path;
    [fm removeItemAtPath:zip error:nil];
    NSTask *ditto = [NSTask new];
    ditto.executableURL = [NSURL fileURLWithPath:@"/usr/bin/ditto"];
    ditto.arguments = @[@"-c", @"-k", @"--sequesterRsrc", @"--keepParent", temp, zip];
    NSError *zipError = nil;
    BOOL ok = [ditto launchAndReturnError:&zipError] && (([ditto waitUntilExit]), ditto.terminationStatus == 0);
    [fm removeItemAtPath:temp error:nil];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (ok) {
        [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[panel.URL]];
      } else {
        [self alert:@"Could not create diagnostics" info:zipError.localizedDescription ?: @"ditto failed."];
      }
    });
  }];
}

- (void)checkForUpdates:(id)sender {
#if HD_SPARKLE
  if (self.updaterController) {
    [self.updaterController checkForUpdates:nil];
    return;
  }
#endif
  [self alert:@"Updates are not configured"
         info:@"This build has no Sparkle feed. Set SU_FEED_URL and SU_PUBLIC_ED_KEY for a release build."];
}

- (void)updateLaunchAtLoginState {
  self.ui.loginCheckbox.state = [SMAppService mainAppService].status == SMAppServiceStatusEnabled ? NSControlStateValueOn : NSControlStateValueOff;
  if (!self.loginItemMenuItem) return;
  self.loginItemMenuItem.state = [SMAppService mainAppService].status == SMAppServiceStatusEnabled ? NSControlStateValueOn : NSControlStateValueOff;
}

- (void)toggleLaunchAtLogin:(id)sender {
  SMAppService *service = [SMAppService mainAppService];
  NSError *error = nil;
  if (service.status == SMAppServiceStatusEnabled) {
    [service unregisterAndReturnError:&error];
  } else {
    [service registerAndReturnError:&error];
  }
  [self updateLaunchAtLoginState];
  if (error) {
    [self alert:@"Could not update Launch at Login"
           info:[NSString stringWithFormat:@"%@\n\nMove ClipSpike to /Applications before enabling this.", error.localizedDescription]];
  }
}

- (void)showOnboardingIfNeeded {
  NSMutableDictionary *config = [self loadConfig];
  if (!config || [config[@"onboardingComplete"] boolValue]) return;
  [self showOnboarding:nil];
}

- (void)markOnboardingComplete {
  NSMutableDictionary *config = [self loadConfig];
  if (!config) return;
  config[@"onboardingComplete"] = @YES;
  [self writeConfig:config];
}

- (void)showOnboarding:(id)sender {
  if (self.ui) { [self.ui presentOnboarding]; return; }
  if (!self.onboardingWindow) {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 560, 420)
                                                   styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"Getting Started";
    window.releasedWhenClosed = NO;
    NSView *view = window.contentView;

    NSTextField *heading = [NSTextField labelWithString:@"Welcome to ClipSpike"];
    heading.font = [NSFont boldSystemFontOfSize:22];
    heading.frame = NSMakeRect(24, 360, 512, 28);
    [view addSubview:heading];

    NSTextField *intro = [NSTextField wrappingLabelWithString:@"Turn chat reactions into ready-to-post 9:16 clips.\n\n1. Enter the Twitch username to watch.\n2. Choose Local only, Dropbox, or Google Drive.\n3. Start capture. Leave the app running while you stream."];
    intro.frame = NSMakeRect(24, 250, 512, 96);
    [view addSubview:intro];

    self.onboardingChannel = [NSTextField textFieldWithString:[[NSUserDefaults standardUserDefaults] stringForKey:@"channel"] ?: @""];
    self.onboardingChannel.placeholderString = @"Twitch username";
    self.onboardingChannel.frame = NSMakeRect(24, 210, 300, 28);
    [view addSubview:self.onboardingChannel];

    self.onboardingPermission = [NSButton checkboxWithTitle:@"I have permission to record the channels I monitor." target:nil action:nil];
    self.onboardingPermission.frame = NSMakeRect(24, 176, 500, 22);
    [view addSubview:self.onboardingPermission];

    NSButton *storage = [NSButton buttonWithTitle:@"Choose Storage" target:self action:@selector(onboardingStorage:)];
    storage.frame = NSMakeRect(24, 126, 130, 32);
    [view addSubview:storage];

    NSButton *license = [NSButton buttonWithTitle:@"License" target:self action:@selector(onboardingLicense:)];
    license.frame = NSMakeRect(162, 126, 100, 32);
    [view addSubview:license];

    NSButton *start = [NSButton buttonWithTitle:@"Start capture" target:self action:@selector(onboardingStart:)];
    start.frame = NSMakeRect(270, 126, 140, 32);
    start.keyEquivalent = @"\r";
    [view addSubview:start];

    NSButton *skip = [NSButton buttonWithTitle:@"Later" target:self action:@selector(onboardingSkip:)];
    skip.frame = NSMakeRect(418, 126, 90, 32);
    [view addSubview:skip];

    NSTextField *note = [NSTextField wrappingLabelWithString:@"You can reopen this guide from the app menu. Storage and license settings are also available in the menu."];
    note.font = [NSFont systemFontOfSize:11];
    note.textColor = [NSColor secondaryLabelColor];
    note.frame = NSMakeRect(24, 68, 512, 38);
    [view addSubview:note];

    NSButton *close = [NSButton buttonWithTitle:@"Close" target:self action:@selector(onboardingSkip:)];
    close.frame = NSMakeRect(24, 24, 100, 32);
    [view addSubview:close];

    self.onboardingWindow = window;
    [window center];
  }
  [self.onboardingWindow makeKeyAndOrderFront:nil];
}

- (void)onboardingStorage:(id)sender {
  [self showStorageSettings:nil];
}

- (void)onboardingLicense:(id)sender {
  [self showLicense:nil];
}

- (void)onboardingSkip:(id)sender {
  [self markOnboardingComplete];
  if (self.ui) [self.ui dismissOnboarding];
  else [self.onboardingWindow close];
}

- (void)onboardingStart:(id)sender {
  if (self.ui) {
    self.onboardingChannel = self.ui.onboardingChannel;
    self.onboardingPermission = self.ui.onboardingPermission;
  }
  if (self.onboardingPermission.state != NSControlStateValueOn) {
    [self alert:@"Recording permission" info:@"Confirm that you have permission to record the channels you monitor."];
    return;
  }
  NSString *name = [self.onboardingChannel.stringValue stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]].lowercaseString;
  if (!name.length) {
    [self alert:@"Enter a Twitch username" info:@"Use the channel name from the URL, for example twitch.tv/your_channel."];
    return;
  }
  self.channel.stringValue = name;
  [[NSUserDefaults standardUserDefaults] setObject:name forKey:@"channel"];
  [self markOnboardingComplete];
  if (self.ui) [self.ui dismissOnboarding];
  else [self.onboardingWindow close];
  if (self.ui && self.ui.onboardingStoragePopup.indexOfSelectedItem > 0) {
    NSInteger index = self.ui.onboardingStoragePopup.indexOfSelectedItem;
    [self.ui selectPage:HDPageStorage];
    [self.storageModePopup selectItemAtIndex:index];
    [self storageModeChanged:nil];
    return;
  }
  if (self.ui && self.ui.onboardingStoragePopup.indexOfSelectedItem == 0) {
    [self.storageModePopup selectItemAtIndex:0];
    [self saveStorageSettings:nil];
  }
  [self toggleCapture:nil];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [HDMigration runIfNeeded];
  NSString *envConfig = HDEnv(@"CLIPSPIKE_CONFIG");
  self.configPath = envConfig.length ? [envConfig stringByExpandingTildeInPath] : [NSHomeDirectory() stringByAppendingPathComponent:@".clipspike.json"];
  NSString *envState = HDEnv(@"CLIPSPIKE_STATE");
  self.stateDir = envState.length ? [envState stringByExpandingTildeInPath] : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClipSpike"];
  [self migrateCredentialsIfNeeded];
  NSString *forcedAppearance = HDEnv(@"CLIPSPIKE_APPEARANCE");
  if ([forcedAppearance isEqualToString:@"light"]) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  else if ([forcedAppearance isEqualToString:@"dark"]) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.licenseRequired = [self licenseIsRequired];
  self.trialDays = [self configuredTrialDays];
  [self logUsageEvent:@"app-launch" details:@{@"licenseRequired": @(self.licenseRequired), @"trialDays": @(self.trialDays)}];
  self.ui = [[HDUI alloc] initWithTarget:self];
  NSDictionary *captureConfig = [self loadConfig][@"app"];
  NSNumber *sensitivity = [captureConfig isKindOfClass:[NSDictionary class]] ? captureConfig[@"sensitivity"] : nil;
  if ([sensitivity isKindOfClass:[NSNumber class]]) [self.ui setSpikeSensitivity:MAX(0.25, MIN(3, sensitivity.doubleValue))];
  self.window = self.ui.window;
  self.window.delegate = self;
  self.channel = self.ui.channelField;
  self.status = self.ui.statusLabel;
  self.telemetry = self.ui.telemetryLabel;
  self.toggle = self.ui.toggleButton;
  self.saveButton = self.ui.saveButton;
  self.lastClipButton = self.ui.lastClipButton;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [self logMissingClipFiles]; });
  self.storageModePopup = self.ui.storageModePopup;
  self.storageStatus = self.ui.storageStatus;
  self.storageFolder = self.ui.storageFolder;
  self.storageConnectButton = self.ui.storageConnectButton;
  self.storageDisconnectButton = self.ui.storageDisconnectButton;
  self.storageDeleteCheckbox = self.ui.storageDeleteCheckbox;
  self.storageKeepLocalCheckbox = self.ui.storageKeepLocalCheckbox;
  self.storageKeepRawCheckbox = self.ui.storageKeepRawCheckbox;
  self.historyTable = self.ui.historyTable;
  self.historyStatus = self.ui.historyStatus;
  self.historyOpenButton = self.ui.historyOpenButton;
  self.licenseStatusLabel = self.ui.licenseStatusLabel;
  self.licenseTrialLabel = self.ui.licenseTrialLabel;
  self.licenseKeyField = self.ui.licenseKeyField;
  self.licenseActivateButton = self.ui.licenseActivateButton;
  self.licenseDeactivateButton = self.ui.licenseDeactivateButton;
  self.licenseCheckButton = self.ui.licenseCheckButton;
  self.licenseBuyButton = self.ui.licenseBuyButton;
  self.onboardingChannel = self.ui.onboardingChannel;
  self.onboardingPermission = self.ui.onboardingPermission;
  self.ui.historyTable.dataSource = self;
  self.ui.historyTable.delegate = self;
  self.status.hidden = YES;

  self.stdoutBuffer = [NSMutableString new];
  self.logLines = [NSMutableArray array];
  [self appendLogLine:[NSString stringWithFormat:@"ClipSpike %@ (%@) started", NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"] ?: @"?", NSBundle.mainBundle.infoDictionary[@"CFBundleVersion"] ?: @"?"]];

  NSMenu *menu = [NSMenu new];
  NSMenuItem *appItem = [menu addItemWithTitle:@"" action:nil keyEquivalent:@""];
  NSMenu *appMenu = [NSMenu new];
  NSMenuItem *settingsItem = [appMenu addItemWithTitle:@"Settings…" action:@selector(openPreferences:) keyEquivalent:@","];
  settingsItem.target = self;
  NSMenuItem *monitorItem = [appMenu addItemWithTitle:@"Capture Monitor…" action:@selector(showMonitoring:) keyEquivalent:@"m"];
  monitorItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
  monitorItem.target = self;
  [appMenu addItem:[NSMenuItem separatorItem]];

  NSMenuItem *saveItem = [appMenu addItemWithTitle:@"Save Highlight Now" action:@selector(saveHighlight:) keyEquivalent:@"s"];
  saveItem.target = self;
  NSMenuItem *folderItem = [appMenu addItemWithTitle:@"Open Clips Folder" action:@selector(folder:) keyEquivalent:@""];
  folderItem.target = self;
  NSMenuItem *siteItem = [appMenu addItemWithTitle:@"Open Web Dashboard" action:@selector(site:) keyEquivalent:@""];
  siteItem.target = self;
  NSMenuItem *configItem = [appMenu addItemWithTitle:@"Storage Settings…" action:@selector(showStorageSettings:) keyEquivalent:@""];
  configItem.target = self;
  NSMenuItem *dropboxItem = [appMenu addItemWithTitle:@"Open Storage" action:@selector(openStorage:) keyEquivalent:@""];
  dropboxItem.target = self;
  NSMenuItem *gettingStartedItem = [appMenu addItemWithTitle:@"Getting Started…" action:@selector(showOnboarding:) keyEquivalent:@""];
  gettingStartedItem.target = self;
  NSMenuItem *historyItem = [appMenu addItemWithTitle:@"History…" action:@selector(showHistory:) keyEquivalent:@""];
  historyItem.target = self;
  NSMenuItem *updateItem = [appMenu addItemWithTitle:@"Check for Updates…" action:@selector(checkForUpdates:) keyEquivalent:@""];
  updateItem.target = self;
  NSMenuItem *diagnosticsItem = [appMenu addItemWithTitle:@"Export Diagnostics…" action:@selector(exportDiagnostics:) keyEquivalent:@""];
  diagnosticsItem.target = self;
  self.loginItemMenuItem = [appMenu addItemWithTitle:@"Launch at Login" action:@selector(toggleLaunchAtLogin:) keyEquivalent:@""];
  self.loginItemMenuItem.target = self;
  [self updateLaunchAtLoginState];
  self.notificationsMenuItem = [appMenu addItemWithTitle:@"Notify When Clips Finish" action:@selector(toggleNotifications:) keyEquivalent:@""];
  self.notificationsMenuItem.target = self;
  [self setupNotifications];
  NSMenuItem *licenseItem = [appMenu addItemWithTitle:@"License…" action:@selector(showLicense:) keyEquivalent:@""];
  licenseItem.target = self;
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Quit ClipSpike" action:@selector(terminate:) keyEquivalent:@"q"];
  appItem.submenu = appMenu;
  // Standard responder actions keep text editing and keyboard navigation native.
  NSMenuItem *editItem = [menu addItemWithTitle:@"Edit" action:nil keyEquivalent:@""];
  NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Edit"];
  for (NSArray *entry in @[@[@"Undo", @"undo:", @"z"], @[@"Redo", @"redo:", @"Z"],
                           @[@"Cut", @"cut:", @"x"], @[@"Copy", @"copy:", @"c"],
                           @[@"Paste", @"paste:", @"v"], @[@"Select All", @"selectAll:", @"a"]]) {
    if ([entry[0] isEqualToString:@"Cut"]) [edit addItem:[NSMenuItem separatorItem]];
    [edit addItemWithTitle:entry[0] action:NSSelectorFromString(entry[1]) keyEquivalent:entry[2]];
  }
  editItem.submenu = edit;
  NSMenuItem *viewItem = [menu addItemWithTitle:@"View" action:nil keyEquivalent:@""];
  NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
  NSInteger pageIndex = 0;
  for (NSString *title in @[@"Capture", @"Clips", @"Storage"]) {
    NSMenuItem *item = [viewMenu addItemWithTitle:title action:@selector(navigateToPage:) keyEquivalent:[NSString stringWithFormat:@"%ld", (long)pageIndex + 1]];
    item.tag = pageIndex++; item.target = self;
  }
  viewItem.submenu = viewMenu;
  NSApp.mainMenu = menu;
  // The menu bar companion would leak into headless UI review captures and runs.
  if (!HDEnv(@"CLIPSPIKE_UI_REVIEW").length) [self installStatusItem];

  [self reloadStorageSettings];
  [self reloadHistoryFromDisk];
  [self.ui updateSummaryWithClips:0 queue:self.queuedCount storage:[self selectedStorageMode].capitalizedString trial:0];
  [self.window center];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  if ([HDEnv(@"CLIPSPIKE_OPEN_MONITOR") isEqualToString:@"1"]) {
    [self showMonitoring:nil];
  }
  NSString *openPage = HDEnv(@"CLIPSPIKE_OPEN_PAGE");
  if (openPage.length) {
    if ([openPage isEqualToString:@"clips"]) [self.ui selectPage:HDPageClips];
    else if ([openPage isEqualToString:@"storage"]) [self.ui selectPage:HDPageStorage];
    else if ([openPage isEqualToString:@"license"]) [self.ui selectPage:HDPageLicense];
    else if ([openPage isEqualToString:@"settings"]) [self.ui selectPage:HDPageSettings];
    else [self.ui selectPage:HDPageCapture];
  }
  if ([HDEnv(@"CLIPSPIKE_OPEN_STORAGE") isEqualToString:@"1"]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self showStorageSettings:nil];
    });
  }
  if ([HDEnv(@"CLIPSPIKE_OPEN_HISTORY") isEqualToString:@"1"]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self showHistory:nil];
    });
  }
  if ([HDEnv(@"CLIPSPIKE_OPEN_LICENSE") isEqualToString:@"1"]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self showLicense:nil];
    });
  }
  [self refreshLicenseState];
  NSString *reviewDirectory = HDEnv(@"CLIPSPIKE_UI_REVIEW");
  if (reviewDirectory.length) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self exportUIReview:reviewDirectory];
    });
    return;
  }
  if ([HDEnv(@"CLIPSPIKE_OPEN_ONBOARDING") isEqualToString:@"1"]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self showOnboarding:nil];
    });
  } else if (!HDEnv(@"CLIPSPIKE_UI_REVIEW").length) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.7 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self showOnboardingIfNeeded];
    });
  }
}

- (void)navigateToPage:(NSMenuItem *)sender { [self.ui selectPage:(HDPage)sender.tag]; }

// MARK: Menu bar live companion

- (void)installStatusItem {
  if (self.statusItem) return;
  NSStatusItem *item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  NSImage *icon = [HDSymbolImage(HDSymbolRoleCapture, 14, NSFontWeightMedium, @"ClipSpike") copy];
  icon.template = YES;
  item.button.image = icon;
  item.button.imagePosition = NSImageLeft;
  item.button.accessibilityLabel = @"ClipSpike";
  item.button.toolTip = @"ClipSpike";
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"ClipSpike"];
  menu.delegate = self;
  self.statusStateItem = [menu addItemWithTitle:@"Idle" action:nil keyEquivalent:@""];
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *save = [menu addItemWithTitle:@"Save Highlight" action:@selector(saveHighlight:) keyEquivalent:@"s"];
  save.keyEquivalentModifierMask = NSEventModifierFlagCommand;
  save.target = self;
  NSMenuItem *missed = [menu addItemWithTitle:@"Mark missed moment" action:@selector(statusItemMarkMissed:) keyEquivalent:@""];
  missed.target = self;
  self.statusToggleItem = [menu addItemWithTitle:@"Start capture" action:@selector(toggleCapture:) keyEquivalent:@""];
  self.statusToggleItem.target = self;
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *show = [menu addItemWithTitle:@"Show ClipSpike" action:@selector(showMainWindow:) keyEquivalent:@""];
  show.target = self;
  item.menu = menu;
  self.statusItem = item;
  __weak typeof(self) weakSelf = self;
  self.statusTimer = [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) { [weakSelf refreshStatusItem]; }];
  self.statusTimer.tolerance = 0.5;
  [self refreshStatusItem];
}

- (void)refreshStatusItem {
  if (!self.statusItem) return;
  BOOL live = self.task.running;
  BOOL scanning = !live && self.vodTask.running;
  NSInteger clips = self.clipCount;
  NSString *state = live ? [NSString stringWithFormat:@"● Live · %ld clip%@", (long)clips, clips == 1 ? @"" : @"s"] : (scanning ? @"Finding highlights…" : @"Idle");
  NSString *signature = [NSString stringWithFormat:@"%@|%d", state, live];
  if ([signature isEqualToString:self.statusItemSignature]) return;
  self.statusItemSignature = signature;
  self.statusStateItem.title = state;
  self.statusToggleItem.title = live ? @"Stop capture" : @"Start capture";
  if (live) {
    NSMutableAttributedString *title = [[NSMutableAttributedString alloc] initWithString:@" ● " attributes:@{NSForegroundColorAttributeName:[NSColor systemRedColor], NSFontAttributeName:[NSFont systemFontOfSize:10]}];
    [title appendAttributedString:[[NSAttributedString alloc] initWithString:[NSString stringWithFormat:@"Live · %ld", (long)clips] attributes:@{NSFontAttributeName:[NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium]}]];
    self.statusItem.button.attributedTitle = title;
  } else {
    self.statusItem.button.attributedTitle = [[NSAttributedString alloc] initWithString:@""];
  }
  self.statusItem.button.accessibilityValue = state;
}

- (void)menuNeedsUpdate:(NSMenu *)menu {
  self.statusItemSignature = nil;
  [self refreshStatusItem];
}

- (void)statusItemMarkMissed:(id)sender {
  [self markMissedMoment:sender];
  self.status.stringValue = @"Missed moment marked for review. Capture continues.";
}

- (void)showMainWindow:(id)sender {
  if (self.window.isMiniaturized) [self.window deminiaturize:nil];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

// MARK: Reframe layout

- (void)reframeSettingsChanged:(NSDictionary *)settings {
  NSMutableDictionary *config = [self loadConfig];
  if (!config) return;
  NSMutableDictionary *reframe = [config[@"reframe"] isKindOfClass:NSMutableDictionary.class] ? config[@"reframe"] : [NSMutableDictionary dictionary];
  NSString *layout = [settings[@"layout"] isEqual:@"split"] ? @"split" : @"blur";
  double ratio = MAX(0.20, MIN(0.50, round([settings[@"camHeightRatio"] doubleValue] * 100) / 100));
  NSString *corner = [@[@"top-left", @"top-right", @"bottom-left", @"bottom-right"] containsObject:settings[@"facecamCorner"]] ? settings[@"facecamCorner"] : @"bottom-left";
  reframe[@"layout"] = layout;
  reframe[@"camHeightRatio"] = @(ratio);
  reframe[@"facecamCorner"] = corner;
  config[@"reframe"] = reframe;
  if (![self writeConfig:config]) {
    [self alert:@"Could not save the layout." info:@"The configuration file could not be written."];
    return;
  }
  [self logUsageEvent:@"reframe-layout" details:@{@"layout": layout, @"camHeightRatio": @(ratio), @"facecamCorner": corner}];
}

- (BOOL)validateMenuItem:(NSMenuItem *)item {
  if (item.action == @selector(saveHighlight:)) return self.saveButton.enabled;
  if (item.action == @selector(statusItemMarkMissed:)) return self.task.running && self.monitorSnapshot[@"lastWindow"] != nil;
  if (item.action == @selector(toggleCapture:)) return self.toggle.enabled && !(self.vodTask.running && !self.task.running);
  if (item.action == @selector(navigateToPage:)) {
    item.state = self.ui.selectedPage == item.tag ? NSControlStateValueOn : NSControlStateValueOff;
  }
  return YES;
}

- (void)exportUIReview:(NSString *)directory {
  [[NSFileManager defaultManager] createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
  NSMutableDictionary *checks = [NSMutableDictionary dictionary];
  [self reloadStorageSettings];
  checks[@"storageInitiallySaved"] = @(!self.ui.storageSaveButton.enabled);
  [self.ui.storageModePopup selectItemAtIndex:1]; [self storageModeChanged:nil];
  checks[@"destinationChangeNeedsSave"] = @(self.ui.storageSaveButton.enabled);
  checks[@"cloudRetentionAvailable"] = @(!self.ui.storageKeepLocalCheckbox.hidden && self.ui.storageKeepLocalCheckbox.enabled);
  [self.ui.storageModePopup selectItemAtIndex:0]; [self storageModeChanged:nil];
  checks[@"cloudOptionsHiddenForLocal"] = @(self.ui.storageKeepLocalCheckbox.hidden && self.ui.storageFolder.superview.hidden);
  [self reloadStorageSettings];
  [self.ui presentOnboarding];
  NSButton *start = [self.ui valueForKey:@"onboardingContinue"];
  self.ui.onboardingChannel.stringValue = @"valid_channel";
  self.ui.onboardingPermission.state = NSControlStateValueOff;
  [self.ui performSelector:@selector(onboardingInputChanged:) withObject:nil];
  checks[@"permissionRequired"] = @(!start.enabled);
  self.ui.onboardingPermission.state = NSControlStateValueOn;
  self.ui.onboardingChannel.stringValue = @"invalid username";
  [self.ui performSelector:@selector(onboardingInputChanged:) withObject:nil];
  checks[@"invalidUsernameBlocked"] = @(!start.enabled);
  self.ui.onboardingChannel.stringValue = @"valid_channel";
  [self.ui performSelector:@selector(onboardingInputChanged:) withObject:nil];
  checks[@"validSetupEnabled"] = @(start.enabled);
  [self.ui dismissOnboarding];
  self.ui.clipSearchField.stringValue = @"no_matching_clip_12345"; [self reloadHistoryFromDisk];
  checks[@"searchFiltersRows"] = @(self.historyItems.count == 0);
  self.ui.clipSearchField.stringValue = @""; [self reloadHistoryFromDisk];
  checks[@"emptyTableHidden"] = @([[self.ui valueForKey:@"libraryScroll"] isHidden] == (self.historyItems.count == 0));
  self.ui.clipSearchField.stringValue = @"no_matching_clip_12345"; [self reloadHistoryFromDisk];
  checks[@"filteredEmptyState"] = @([[[self.ui valueForKey:@"libraryEmptyTitle"] stringValue] isEqualToString:@"No matching clips"]);
  [self.ui performSelector:@selector(libraryEmptyClicked:) withObject:nil];
  checks[@"clearSearchAndFilters"] = @(self.ui.clipSearchField.stringValue.length == 0 && self.ui.clipFilterControl.selectedSegment == 0);
  NSInteger savedMode = self.ui.captureModeControl.selectedSegment;
  self.ui.captureModeControl.selectedSegment = 1;
  [self.ui performSelector:@selector(syncCaptureMode)];
  [self.ui setSessionState:HDSessionStateReady status:@""];
  checks[@"vodSourceVisible"] = @(!self.ui.vodField.superview.superview.hidden && self.ui.channelField.superview.superview.hidden);
  self.ui.captureModeControl.selectedSegment = savedMode;
  [self.ui performSelector:@selector(syncCaptureMode)];
  [self.ui setSessionState:HDSessionStateReady status:@""];
  [self.window makeFirstResponder:nil];
  BOOL passed = YES; for (NSNumber *value in checks.allValues) if (!value.boolValue) passed = NO;
  checks[@"noRecorderStarted"] = @(self.task == nil);
  if (self.task) passed = NO;
  checks[@"passed"] = @(passed);
  [[NSJSONSerialization dataWithJSONObject:checks options:NSJSONWritingPrettyPrinted error:nil] writeToFile:[directory stringByAppendingPathComponent:@"behavior-checks.json"] atomically:YES];
  [self reviewScreen:0 directory:directory];
}

- (void)reviewScreen:(NSInteger)index directory:(NSString *)directory {
  if (index >= 24) {
    [self.window setContentSize:NSMakeSize(1080,720)];
    [self.ui selectPage:HDPageCapture]; [self.ui presentOnboarding];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3*NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      NSWindow *sheet = self.window.attachedSheet;
      NSString *path = [directory stringByAppendingPathComponent:@"onboarding.png"];
      NSTask *capture = [NSTask new]; capture.executableURL = [NSURL fileURLWithPath:@"/usr/sbin/screencapture"];
      capture.arguments = @[@"-x", @"-o", @"-l", [NSString stringWithFormat:@"%ld",(long)sheet.windowNumber], path];
      [capture launchAndReturnError:nil]; [capture waitUntilExit];
      [self.ui dismissOnboarding]; [NSApp terminate:nil];
    });
    return;
  }
  NSArray *names = @[@"capture", @"clips", @"storage", @"license", @"settings"];
  BOOL vodReview = index >= 20;
  BOOL dark = vodReview ? index >= 22 : index >= 10;
  BOOL large = vodReview ? index % 2 == 1 : (index % 10) >= 5;
  NSInteger page = vodReview ? 0 : index % 5;
  NSApp.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  [self.window setContentSize:large ? NSMakeSize(1240,820) : NSMakeSize(960,640)];
  [self.ui selectPage:(HDPage)page];
  self.ui.captureModeControl.selectedSegment = vodReview ? 1 : 0;
  [self.ui performSelector:@selector(syncCaptureMode)];
  if (vodReview) {
    NSButton *disclosure = [self.ui valueForKey:@"vodOptionsDisclosure"];
    disclosure.state = NSControlStateValueOn;
    [self.ui performSelector:@selector(vodOptionsToggled:) withObject:nil];
  }
  [self.ui setSessionState:HDSessionStateReady status:@""];
  // Synthetic data so each new surface is visible in review captures. UI only: no recorder, no config writes.
  if (!vodReview && page == HDPageCapture) {
    [self.ui resetChatPulse];
    double series[] = {6,7,5,8,9,7,6,8,10,9,7,8,11,9,8,12,10,9,14,31,36,18,12,10,9,11,8,9,10,13,12,38,44,22,14,11};
    for (NSUInteger i = 0; i < sizeof(series) / sizeof(series[0]); i++) {
      BOOL fired = series[i] > 30 && (i == 20 || i == 32);
      [self.ui recordChatSample:@{@"participants": @(series[i]), @"threshold": @(24), @"median": @(9), @"reactions": @(series[i] / 2), @"trigger": @(fired), @"at": [NSDate dateWithTimeIntervalSinceNow:-5.0 * (36 - (double)i)], @"topEmotes": fired ? @[@{@"name": @"KEKW", @"count": @14}, @{@"name": @"PogChamp", @"count": @9}] : @[]}];
    }
    [self.ui recordChatTrigger:@{@"participants": @44, @"topEmotes": @[@{@"name": @"KEKW", @"count": @14}, @{@"name": @"PogChamp", @"count": @9}]}];
  }
  if (!vodReview && page == HDPageClips && self.historyItems.count) {
    [self.historyTable selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];
  }
  if (!vodReview && page == HDPageStorage) {
    [self.ui setReframeLayout:dark ? @"split" : @"blur" camHeightRatio:0.35 facecamCorner:@"top-right"];
  }
  [self.window makeFirstResponder:nil];
  if (!vodReview && page == HDPageCapture) [self.ui setSessionState:HDSessionStateLive status:@"Chat connected. Highlights are being captured."];
  [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.2*NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self.window.contentView layoutSubtreeIfNeeded]; [self.window displayIfNeeded];
    NSString *name = [NSString stringWithFormat:@"%@-%@-%@.png", vodReview ? @"vod" : names[page], dark ? @"dark" : @"light", large ? @"large" : @"small"];
    NSString *path = [directory stringByAppendingPathComponent:name];
    NSTask *capture = [NSTask new]; capture.executableURL = [NSURL fileURLWithPath:@"/usr/sbin/screencapture"];
    capture.arguments = @[@"-x", @"-o", @"-l", [NSString stringWithFormat:@"%ld",(long)self.window.windowNumber], path];
    [capture launchAndReturnError:nil]; [capture waitUntilExit];
    [self reviewScreen:index+1 directory:directory];
  });
}

- (NSArray<NSString *> *)searchPaths {
  NSMutableArray<NSString *> *paths = [NSMutableArray array];
  NSString *bundledRuntime = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"runtime/bin"];
  if (bundledRuntime.length && [[NSFileManager defaultManager] fileExistsAtPath:bundledRuntime]) {
    [paths addObject:bundledRuntime];
  }
  [paths addObjectsFromArray:@[
    @"/opt/homebrew/opt/ffmpeg-full/bin",
    @"/opt/homebrew/bin",
    @"/usr/local/bin",
    @"/usr/bin",
    @"/bin",
    @"/usr/sbin",
    @"/sbin"
  ]];
  NSString *envPath = NSProcessInfo.processInfo.environment[@"PATH"];
  if (envPath.length) {
    for (NSString *part in [envPath componentsSeparatedByString:@":"]) {
      if (part.length && ![paths containsObject:part]) [paths addObject:part];
    }
  }
  return paths;
}

- (NSString *)findTool:(NSString *)tool paths:(NSArray<NSString *> *)paths {
  for (NSString *directory in paths) {
    NSString *path = [directory stringByAppendingPathComponent:tool];
    if ([[NSFileManager defaultManager] isExecutableFileAtPath:path]) return path;
  }
  return nil;
}

- (void)alert:(NSString *)message info:(NSString *)info {
  NSAlert *alert = [NSAlert new];
  alert.messageText = message;
  alert.informativeText = info ?: @"";
  [alert runModal];
}

- (void)consumeStderr:(NSString *)text {
  if (!text.length) return;
  for (NSString *line in [text componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]]) {
    NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (!trimmed.length) continue;
    self.lastError = trimmed.length > 400 ? [trimmed substringFromIndex:trimmed.length - 400] : trimmed;
    [self appendLogLine:[NSString stringWithFormat:@"stderr: %@", trimmed]];
  }
}

- (void)consumeStdout:(NSString *)text {
  if (!text.length) return;
  [self.stdoutBuffer appendString:text];
  NSRange newline;
  while ((newline = [self.stdoutBuffer rangeOfString:@"\n"]).location != NSNotFound) {
    NSString *line = [self.stdoutBuffer substringToIndex:newline.location];
    [self.stdoutBuffer deleteCharactersInRange:NSMakeRange(0, newline.location + 1)];
    if (line.length) {
      [self appendLogLine:[NSString stringWithFormat:@"event: %@", line.length > 2000 ? [line substringToIndex:2000] : line]];
      [self handleEventLine:line];
    }
  }
  if (self.stdoutBuffer.length > 65536) [self.stdoutBuffer setString:@""];
}

- (void)consumeVodStdout:(NSString *)text {
  if (!text.length) return;
  if (!self.vodStdoutBuffer) self.vodStdoutBuffer = [NSMutableString string];
  [self.vodStdoutBuffer appendString:text];
  NSRange newline;
  while ((newline = [self.vodStdoutBuffer rangeOfString:@"\n"]).location != NSNotFound) {
    NSString *line = [self.vodStdoutBuffer substringToIndex:newline.location];
    [self.vodStdoutBuffer deleteCharactersInRange:NSMakeRange(0, newline.location + 1)];
    if (!line.length) continue;
    [self appendLogLine:[NSString stringWithFormat:@"vod event: %@", line.length > 2000 ? [line substringToIndex:2000] : line]];
    self.vodEvents = YES;
    [self handleEventLine:line];
    self.vodEvents = NO;
  }
  // vod-moments carries the whole activity curve, so allow a bigger partial line than live.
  if (self.vodStdoutBuffer.length > 8 * 1024 * 1024) [self.vodStdoutBuffer setString:@""];
}

// VOD-only events. Returns YES when the event was fully handled here.
- (BOOL)handleVodEvent:(NSString *)type event:(NSDictionary *)event {
  if ([type isEqualToString:@"vod-info"]) {
    NSString *channel = [event[@"channelName"] isKindOfClass:[NSString class]] && [event[@"channelName"] length] ? event[@"channelName"] : [event[@"channel"] description];
    NSString *title = [event[@"title"] isKindOfClass:[NSString class]] ? event[@"title"] : @"";
    self.status.stringValue = title.length ? [NSString stringWithFormat:@"%@ · %@", channel ?: @"Twitch", title] : (channel ?: @"Twitch VOD");
    self.telemetry.stringValue = @"Reading chat…";
    [self.ui setSessionState:HDSessionStateLive status:self.status.stringValue];
    return YES;
  }
  if ([type isEqualToString:@"vod-chat-progress"]) {
    NSInteger percent = (NSInteger)llround([event[@"fraction"] doubleValue] * 100);
    self.telemetry.stringValue = [NSString stringWithFormat:@"Reading chat… %ld%%", (long)MAX(0, MIN(100, percent))];
    return YES;
  }
  if ([type isEqualToString:@"vod-download-progress"]) return YES;
  if ([type isEqualToString:@"caption-model-progress"]) {
    if ([event[@"done"] boolValue]) {
      self.telemetry.stringValue = @"Captions model ready";
    } else {
      NSInteger percent = (NSInteger)llround([event[@"fraction"] doubleValue] * 100);
      double megabytes = [event[@"total"] doubleValue] / 1e6;
      self.telemetry.stringValue = megabytes > 0
        ? [NSString stringWithFormat:@"Downloading captions model… %ld%% of %.0f MB (one time)", (long)MAX(0, MIN(100, percent)), megabytes]
        : @"Downloading captions model (one time)…";
    }
    return YES;
  }
  if ([type isEqualToString:@"caption-progress"]) {
    NSInteger index = [event[@"index"] integerValue];
    NSInteger total = MAX(self.vodMomentCount, index);
    if ([event[@"stage"] isEqualToString:@"transcribing"]) {
      self.telemetry.stringValue = [NSString stringWithFormat:@"Transcribing clip %ld of %ld…", (long)index, (long)total];
    } else {
      self.telemetry.stringValue = [NSString stringWithFormat:@"Burning in captions for clip %ld of %ld…", (long)index, (long)total];
    }
    return YES;
  }
  if ([type isEqualToString:@"vod-moments"]) {
    NSArray *moments = [event[@"moments"] isKindOfClass:[NSArray class]] ? event[@"moments"] : @[];
    self.vodMomentCount = moments.count;
    self.telemetry.stringValue = [NSString stringWithFormat:@"Found %ld moment%@", (long)moments.count, moments.count == 1 ? @"" : @"s"];
    return YES;
  }
  if ([type isEqualToString:@"clip-requested"]) {
    self.vodRequested += 1;
    self.telemetry.stringValue = [NSString stringWithFormat:@"Saving clip %ld of %ld", (long)MIN(self.vodRequested, MAX(self.vodMomentCount, self.vodRequested)), (long)MAX(self.vodMomentCount, self.vodRequested)];
    [self logUsageEvent:@"clip-requested" details:@{@"reason": [event[@"reason"] description] ?: @"", @"source": @"vod"}];
    return YES;
  }
  if ([type isEqualToString:@"vod-done"]) {
    NSInteger saved = [event[@"saved"] integerValue];
    self.telemetry.stringValue = [NSString stringWithFormat:@"Done · %ld clip%@", (long)saved, saved == 1 ? @"" : @"s"];
    if (!saved) self.status.stringValue = self.vodMomentCount ? @"No clips were saved." : @"Chat didn't spike anywhere in that range.";
    self.lastClipButton.enabled = self.lastClipPath.length > 0;
    [self logUsageEvent:@"vod-done" details:@{@"saved": @(saved), @"moments": @(self.vodMomentCount)}];
    return YES;
  }
  return NO;
}

- (void)handleEventLine:(NSString *)line {
  NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return;
  NSDictionary *event = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![event isKindOfClass:[NSDictionary class]]) return;
  NSString *type = event[@"type"];
  if (![type isKindOfClass:[NSString class]]) return;

  if (self.vodEvents && [self handleVodEvent:type event:event]) {
    [self.ui updateSummaryWithClips:self.clipCount queue:self.queuedCount storage:self.storageLabel trial:self.trialDays];
    return;
  }
  if (self.vodEvents && [type isEqualToString:@"fatal"]) self.vodFatal = YES;

  if ([type isEqualToString:@"monitor-status"]) {
    self.monitorSnapshot = event;
    [self syncMissedButton];
    if (self.monitorWindow.visible) [self renderMonitoring];
    return;
  }
  if ([type isEqualToString:@"monitor-report"]) {
    self.monitorReport = event[@"report"];
    if (self.monitorWindow.visible) [self renderMonitoring];
    return;
  }
  if ([type isEqualToString:@"monitor-error"]) {
    self.monitorHealth.stringValue = event[@"message"] ?: @"Monitoring paused; capture continues.";
    return;
  }

  if ([type isEqualToString:@"ready"]) {
    NSDictionary *storage = [event[@"storage"] isKindOfClass:[NSDictionary class]] ? event[@"storage"] : nil;
    NSDictionary *dropbox = [event[@"dropbox"] isKindOfClass:[NSDictionary class]] ? event[@"dropbox"] : nil;
    NSDictionary *reframe = [event[@"reframe"] isKindOfClass:[NSDictionary class]] ? event[@"reframe"] : nil;
    if (storage) {
      self.storageMode = [storage[@"mode"] isKindOfClass:[NSString class]] ? storage[@"mode"] : @"local";
      self.storageLabel = [storage[@"label"] isKindOfClass:[NSString class]] ? storage[@"label"] : @"Storage";
      self.storageConfigured = [storage[@"configured"] boolValue];
    } else {
      self.storageMode = @"dropbox";
      self.storageLabel = @"Dropbox";
      self.storageConfigured = [dropbox[@"configured"] boolValue];
    }
    self.dropboxConfigured = [self.storageMode isEqualToString:@"dropbox"] && self.storageConfigured;
    self.reframeEnabled = [reframe[@"enabled"] boolValue];
    if ([event[@"configPath"] isKindOfClass:[NSString class]]) self.configPath = event[@"configPath"];
    if ([event[@"stateDir"] isKindOfClass:[NSString class]]) self.stateDir = event[@"stateDir"];
    if ([event[@"output"] isKindOfClass:[NSString class]]) self.outputPath = event[@"output"];
    NSString *name = [event[@"channel"] description];
    if ([self.storageMode isEqualToString:@"local"]) {
      self.status.stringValue = [NSString stringWithFormat:@"Monitoring #%@. Saving 9:16 clips locally.", name];
    } else if (self.storageConfigured) {
      self.status.stringValue = [NSString stringWithFormat:@"Monitoring #%@. Uploading 9:16 clips to %@.", name, self.storageLabel];
    } else {
      self.status.stringValue = [NSString stringWithFormat:@"Monitoring #%@. %@ is not connected; clips stay local.", name, self.storageLabel];
    }
    self.telemetry.stringValue = [NSString stringWithFormat:@"%@ · %ld clip%@ saved", self.storageLabel, (long)self.clipCount, self.clipCount == 1 ? @"" : @"s"];
    BOOL readyJoined = [event[@"joined"] boolValue];
    [self.ui setSessionState:readyJoined ? HDSessionStateLive : HDSessionStateReconnecting status:self.status.stringValue];
  } else if ([type isEqualToString:@"status"]) {
    BOOL joined = [event[@"joined"] boolValue];
    BOOL recording = [event[@"recording"] boolValue];
    NSString *state = recording ? (joined ? @"chat connected" : @"waiting for chat") : @"reconnecting";
    NSNumber *score = [event[@"score"] isKindOfClass:[NSNumber class]] ? event[@"score"] : nil;
    NSNumber *threshold = [event[@"threshold"] isKindOfClass:[NSNumber class]] ? event[@"threshold"] : nil;
    if (score && threshold) {
      self.telemetry.stringValue = [NSString stringWithFormat:@"%@ · chat %@/%@ · %ld clip%@", state, score, threshold, (long)self.clipCount, self.clipCount == 1 ? @"" : @"s"];
    } else {
      self.telemetry.stringValue = [NSString stringWithFormat:@"%@ · %ld clip%@ saved · %@ · %ld queued", state, (long)self.clipCount, self.clipCount == 1 ? @"" : @"s", self.storageLabel ?: @"Storage", (long)self.queuedCount];
    }
    NSInteger participants = [event[@"participants"] integerValue];
    NSInteger reactions = [event[@"reactions"] integerValue];
    if (event[@"participants"] && !self.vodEvents) [self.ui recordChatSample:event];
    if (joined || participants > 0 || reactions > 0) {
      [self logUsageEvent:@"chat-sample" details:@{
        @"joined": @(joined), @"recording": @(recording),
        @"participants": @(participants), @"reactions": @(reactions),
        @"messages": @([event[@"messages"] integerValue]),
        @"score": score ?: @0, @"threshold": threshold ?: @0,
        @"median": [event[@"median"] isKindOfClass:[NSNumber class]] ? event[@"median"] : @0,
        @"reactionFloor": [event[@"reactionFloor"] isKindOfClass:[NSNumber class]] ? event[@"reactionFloor"] : @0,
        @"trigger": @([event[@"trigger"] boolValue]),
        @"reasons": [event[@"reasons"] isKindOfClass:[NSArray class]] ? event[@"reasons"] : @[]
      }];
    }
    if (recording && joined) {
      [self.ui setSessionState:HDSessionStateLive status:self.status.stringValue];
    } else if (recording) {
      [self.ui setSessionState:HDSessionStateReconnecting status:self.status.stringValue];
    } else {
      [self.ui setSessionState:HDSessionStateReconnecting status:self.status.stringValue];
    }
  } else if ([type isEqualToString:@"clip-requested"]) {
    [self.ui setExportStage:@"Collecting video" color:NSColor.controlAccentColor];
    self.status.stringValue = @"Saving highlight…";
    [self logUsageEvent:@"clip-requested" details:@{@"reason": [event[@"reason"] description] ?: @""}];
  } else if ([type isEqualToString:@"clip-exported"]) {
    [self.ui setExportStage:self.reframeEnabled ? @"Rendering vertical clip" : @"Preparing export" color:NSColor.controlAccentColor];
    self.status.stringValue = self.reframeEnabled ? @"Reframing the clip to 9:16…" : @"Preparing the clip…";
  } else if ([type isEqualToString:@"clip-reframed"]) {
    BOOL cloud = ![self.storageMode isEqualToString:@"local"] && self.storageConfigured;
    self.status.stringValue = cloud ? [NSString stringWithFormat:@"Uploading to %@…", self.storageLabel] : @"Saved the 9:16 clip locally.";
  } else if ([type isEqualToString:@"clip-uploading"]) {
    NSString *provider = [event[@"provider"] isKindOfClass:[NSString class]] ? event[@"provider"] : self.storageMode;
    if ([provider isEqualToString:@"googleDrive"]) self.storageLabel = @"Google Drive";
    else if ([provider isEqualToString:@"dropbox"]) self.storageLabel = @"Dropbox";
    [self.ui setExportStage:@"Uploading" color:NSColor.controlAccentColor];
    self.status.stringValue = [NSString stringWithFormat:@"Uploading to %@…", self.storageLabel ?: @"storage"];
  } else if ([type isEqualToString:@"review-ready"]) {
    NSString *message = [event[@"message"] isKindOfClass:NSString.class] ? event[@"message"] : @"Open Capture Monitor to review your highlights.";
    [self notifyTitle:@"ClipSpike" body:message];
    [self logUsageEvent:@"review-ready" details:@{@"sessions": event[@"sessions"] ?: @0}];
  } else if ([type isEqualToString:@"clip-uploaded"]) {
    if ([event[@"queued"] boolValue]) [self logFeedbackAction:@"uploaded" clipId:event[@"clipId"] details:@{@"provider": event[@"provider"] ?: @"", @"queued": @YES}];
    self.status.stringValue = [NSString stringWithFormat:@"Uploaded to %@. Confirming and cleaning up…", self.storageLabel ?: @"storage"];
    if ([event[@"webLink"] isKindOfClass:[NSString class]]) self.lastRemoteURL = event[@"webLink"];
    if ([event[@"queued"] boolValue]) {
      [self notifyTitle:@"Queued upload complete" body:[NSString stringWithFormat:@"The retry to %@ succeeded.", self.storageLabel ?: @"cloud storage"]];
    }
  } else if ([type isEqualToString:@"clip-deleted"]) {
    if ([event[@"keptLocal"] boolValue]) {
      self.status.stringValue = @"Upload confirmed. A local copy was kept.";
    } else {
      self.status.stringValue = [event[@"complete"] boolValue] ? @"Upload confirmed. Local videos removed." : @"Upload confirmed. A local copy was kept.";
    }
  } else if ([type isEqualToString:@"queue-updated"]) {
    NSArray *items = [event[@"items"] isKindOfClass:[NSArray class]] ? event[@"items"] : @[];
    self.queueItems = [items mutableCopy];
    self.queuedCount = items.count;
    self.telemetry.stringValue = [NSString stringWithFormat:@"%@ · %ld clip%@ saved · %ld queued", self.storageLabel ?: @"Storage", (long)self.clipCount, self.clipCount == 1 ? @"" : @"s", (long)self.queuedCount];
    if (self.ui || self.historyWindow.isVisible) [self reloadHistoryFromDisk];
  } else if ([type isEqualToString:@"history-updated"]) {
    NSArray *items = [event[@"items"] isKindOfClass:[NSArray class]] ? event[@"items"] : @[];
    if (self.ui || self.historyWindow.isVisible) [self reloadHistoryFromDisk];
    else self.historyItems = [items mutableCopy];
  } else if ([type isEqualToString:@"clip-saved"]) {
    self.clipCount += 1;
    NSDictionary *metadata = [event[@"metadata"] isKindOfClass:[NSDictionary class]] ? event[@"metadata"] : nil;
    NSString *reason = [metadata[@"reason"] isKindOfClass:[NSString class]] ? metadata[@"reason"] : @"highlight";
    NSString *path = [event[@"path"] isKindOfClass:[NSString class]] ? event[@"path"] : nil;
    if (!self.vodEvents) [self.ui recordChatTrigger:@{@"participants": metadata[@"participants"] ?: @0, @"topEmotes": metadata[@"topEmotes"] ?: @[]}];
    NSString *provider = [event[@"provider"] isKindOfClass:[NSString class]] ? event[@"provider"] : self.storageMode;
    NSString *remotePath = [event[@"remotePath"] isKindOfClass:[NSString class]] ? event[@"remotePath"] : nil;
    if ([event[@"webLink"] isKindOfClass:[NSString class]]) self.lastRemoteURL = event[@"webLink"];
    if ([provider isEqualToString:@"googleDrive"]) self.storageLabel = @"Google Drive";
    else if ([provider isEqualToString:@"dropbox"]) self.storageLabel = @"Dropbox";
    else if ([provider isEqualToString:@"local"]) self.storageLabel = @"Local only";
    BOOL deleted = [event[@"deletedLocal"] boolValue];
    BOOL queued = [event[@"queued"] boolValue];
    [self.ui setExportStage:queued ? @"Upload queued" : @"Export saved" color:queued ? NSColor.systemOrangeColor : NSColor.secondaryLabelColor];
    self.lastClipId = [metadata[@"id"] isKindOfClass:NSString.class] ? metadata[@"id"] : nil;
    if (remotePath.length && !queued) [self logFeedbackAction:@"uploaded" clipId:self.lastClipId details:@{@"provider": provider ?: @""}];
    [self logUsageEvent:@"clip-saved" details:@{
      @"reason": reason, @"provider": provider ?: @"",
      @"deletedLocal": @(deleted), @"queued": @(queued),
      @"remotePath": remotePath ?: @"", @"path": path ?: @"",
      @"metadata": metadata ?: @{}
    }];
    if (deleted || !path.length) {
      self.lastClipPath = nil;
      self.lastClipButton.enabled = NO;
      self.status.stringValue = [NSString stringWithFormat:@"Uploaded clip #%ld · %@. Local video removed.", (long)self.clipCount, reason];
    } else {
      self.lastClipPath = path;
      self.lastClipButton.enabled = YES;
      if (queued) {
        self.status.stringValue = [NSString stringWithFormat:@"Saved clip #%ld · %@ locally. Upload queued.", (long)self.clipCount, reason];
      } else if ([provider isEqualToString:@"local"]) {
        self.status.stringValue = [NSString stringWithFormat:@"Saved clip #%ld · %@ locally.", (long)self.clipCount, reason];
      } else if (remotePath.length) {
        self.status.stringValue = [NSString stringWithFormat:@"Uploaded clip #%ld · %@. Local copy kept.", (long)self.clipCount, reason];
      } else {
        self.status.stringValue = [NSString stringWithFormat:@"Saved clip #%ld · %@", (long)self.clipCount, reason];
      }
    }
    self.telemetry.stringValue = [NSString stringWithFormat:@"%ld clip%@ saved · %@ · %ld queued", (long)self.clipCount, self.clipCount == 1 ? @"" : @"s", self.storageLabel ?: @"Storage", (long)self.queuedCount];
    NSString *notificationTitle = queued ? @"Upload queued" : (deleted ? @"Clip uploaded" : (remotePath.length ? @"Clip uploaded" : @"Clip saved"));
    NSString *notificationBody = [NSString stringWithFormat:@"%@ · %@", reason, queued ? @"Saved locally; retrying in the background." : (deleted ? @"Local video removed after confirmation." : (remotePath.length ? [NSString stringWithFormat:@"Sent to %@.", self.storageLabel ?: @"cloud storage"] : @"Saved in your clips folder."))];
    [self notifyTitle:notificationTitle body:notificationBody];
  } else if ([type isEqualToString:@"clip-failed"]) {
    [self.ui setExportStage:@"Export failed" color:NSColor.systemRedColor];
    self.status.stringValue = [NSString stringWithFormat:@"Clip export failed: %@", [event[@"error"] description]];
    [self logUsageEvent:@"clip-failed" details:@{@"error": [event[@"error"] description] ?: @"unknown"}];
  } else if ([type isEqualToString:@"error"]) {
    NSString *message = [event[@"message"] description];
    self.telemetry.stringValue = [NSString stringWithFormat:@"Warning: %@", message];
    [self logUsageEvent:@"engine-error" details:@{@"message": message ?: @"unknown"}];
    [self.ui setSessionState:HDSessionStateError status:message ?: @"Recorder error"];
    if ([message.lowercaseString containsString:@"upload failed"] || [message.lowercaseString containsString:@"retry failed"]) {
      [self notifyTitle:@"Upload needs attention" body:message];
    }
  } else if ([type isEqualToString:@"fatal"]) {
    NSString *message = [event[@"message"] description];
    self.status.stringValue = message;
    [self logUsageEvent:@"engine-fatal" details:@{@"message": message ?: @"unknown"}];
    [self.ui setSessionState:HDSessionStateError status:message ?: @"Recorder stopped"];
    [self alert:@"ClipSpike stopped." info:message];
  }
  if (self.vodEvents && [type isEqualToString:@"clip-saved"]) {
    self.vodSaved += 1;
    NSInteger total = MAX(self.vodMomentCount, self.vodSaved);
    self.telemetry.stringValue = self.vodSaved < total
      ? [NSString stringWithFormat:@"Saving clip %ld of %ld", (long)self.vodSaved + 1, (long)total]
      : [NSString stringWithFormat:@"Saved clip %ld of %ld", (long)self.vodSaved, (long)total];
  }
  if ([type isEqualToString:@"free-tier"] || [type isEqualToString:@"clip-saved"]) [self refreshPlanNote];
  [self.ui updateSummaryWithClips:self.clipCount queue:self.queuedCount storage:self.storageLabel trial:self.trialDays];
  [self refreshStatusItem];
}

- (void)clipSearchChanged:(id)sender {
  [self reloadHistoryFromDisk];
}

- (void)clipFilterChanged:(id)sender {
  [self reloadHistoryFromDisk];
}

- (void)toggleCapture:(id)sender {
  if (!self.task.running && self.vodTask.running) {
    self.status.stringValue = @"Finish or cancel the VOD scan before starting a live capture.";
    return;
  }
  if (self.task.running) {
    [self logUsageEvent:@"capture-stop" details:@{@"channel": self.channel.stringValue ?: @""}];
    self.toggle.enabled = NO;
    self.status.stringValue = @"Stopping capture…";
    [self.ui setSessionState:HDSessionStateStopping status:self.status.stringValue];
    [self.task terminate];
    return;
  }

  NSString *blocked = [self newCaptureBlockReason];
  if (blocked) {
    self.status.stringValue = blocked;
    [self.ui setSessionState:HDSessionStateError status:blocked];
    [self showLicense:nil];
    return;
  }

  NSString *name = [[self.channel.stringValue stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];
  if (![[NSPredicate predicateWithFormat:@"SELF MATCHES %@", @"([a-z0-9_]{1,25}|kick:[a-z0-9_-]{1,25}|(https?://)?(www\\.)?(twitch\\.tv/[a-z0-9_]{1,25}|kick\\.com/[a-z0-9_-]{1,25})/?)"] evaluateWithObject:name]) {
    self.status.stringValue = @"Enter a Twitch username or a live Twitch / Kick channel URL.";
    return;
  }

  NSString *resource = NSBundle.mainBundle.resourcePath;
  NSString *background = [resource stringByAppendingPathComponent:@"background.cjs"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:background]) {
    [self alert:@"ClipSpike is incomplete." info:@"background.cjs is missing from the app bundle. Rebuild with mac/build.sh."];
    return;
  }

  NSArray<NSString *> *paths = [self searchPaths];
  NSString *node = [resource stringByAppendingPathComponent:@"node"];
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:node]) {
    node = [self findTool:@"node" paths:paths];
  }
  if (!node) {
    [self alert:@"Node.js was not found." info:@"Install Node 22 or newer, or rebuild the app with mac/build.sh so the bundled runtime is included."];
    return;
  }

  NSMutableArray<NSString *> *missing = [NSMutableArray array];
  for (NSString *tool in @[@"streamlink", @"ffmpeg"]) {
    if (![self findTool:tool paths:paths]) [missing addObject:tool];
  }
  if (missing.count) {
    [self alert:@"A recording dependency is missing."
           info:[NSString stringWithFormat:@"Install %@ with: brew install %@", [missing componentsJoinedByString:@" and "], [missing componentsJoinedByString:@" "]]];
    return;
  }

  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:node];
  task.arguments = @[background, name];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"PATH"] = [paths componentsJoinedByString:@":"];
  environment[@"CLIPSPIKE_EVENTS"] = @"1";
  [self applyStorageEnvironment:environment];
  NSString *preferredOutput = [[NSUserDefaults standardUserDefaults] stringForKey:@"HDOutputRoot"];
  if (preferredOutput.length) environment[@"CLIPSPIKE_OUTPUT"] = preferredOutput;
  task.environment = environment;

  NSPipe *stdoutPipe = [NSPipe pipe];
  NSPipe *stderrPipe = [NSPipe pipe];
  task.standardOutput = stdoutPipe;
  task.standardError = stderrPipe;
  [self.stdoutBuffer setString:@""];
  self.lastError = nil;

  __weak typeof(self) weakSelf = self;
  stdoutPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length) return;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) return;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf consumeStdout:text]; });
  };
  stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length) return;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) return;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf consumeStderr:text]; });
  };

  task.terminationHandler = ^(NSTask *finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (weakSelf.task != finished) return;
      weakSelf.task = nil;
      [weakSelf renderMonitoring];
      weakSelf.caffeinate = nil;
      weakSelf.channel.enabled = YES;
      weakSelf.toggle.enabled = YES;
      weakSelf.toggle.title = @"Start capture";
      weakSelf.saveButton.enabled = NO;
      [weakSelf syncMissedButton];
      if (finished.terminationStatus == 0) {
        weakSelf.status.stringValue = @"Capture stopped.";
      } else if (weakSelf.lastError.length) {
        weakSelf.status.stringValue = [NSString stringWithFormat:@"Recorder exited: %@", weakSelf.lastError];
      } else {
        weakSelf.status.stringValue = @"Recorder exited. Check that Streamlink and FFmpeg are installed.";
      }
      weakSelf.telemetry.stringValue = [NSString stringWithFormat:@"Recorder stopped · %ld clip%@ saved", (long)weakSelf.clipCount, weakSelf.clipCount == 1 ? @"" : @"s"];
      [weakSelf.ui setCaptureRunning:NO];
      if (finished.terminationStatus == 0) {
        [weakSelf.ui setSessionState:HDSessionStateReady status:@"Capture stopped."];
      } else {
        [weakSelf.ui setSessionState:HDSessionStateError status:weakSelf.lastError ?: @"Recorder exited"];
      }
      [weakSelf.ui updateSummaryWithClips:weakSelf.clipCount queue:weakSelf.queuedCount storage:weakSelf.storageLabel trial:weakSelf.trialDays];
      [weakSelf logUsageEvent:@"capture-exit" details:@{@"status": @(finished.terminationStatus), @"clips": @(weakSelf.clipCount)}];
    });
  };

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    self.status.stringValue = error.localizedDescription;
    [self alert:@"Could not start the recorder." info:error.localizedDescription];
    return;
  }

  self.task = task;
  self.monitorSnapshot = nil;
  self.monitorReport = nil;
  [self logUsageEvent:@"capture-start" details:@{@"channel": name, @"storage": self.storageMode ?: @""}];
  self.clipCount = 0;
  self.channel.enabled = NO;
  self.toggle.title = @"Stop capture";
  self.saveButton.enabled = YES;
  [self syncMissedButton];
  self.status.stringValue = [@"Monitoring #" stringByAppendingString:name];
  self.telemetry.stringValue = @"Starting recorder…";
  [self.ui setCaptureRunning:YES];
  [self.ui setSessionState:HDSessionStateReconnecting status:@"Starting recorder…"];
  [self.ui updateSummaryWithClips:self.clipCount queue:self.queuedCount storage:self.storageLabel trial:self.trialDays];
  [[NSUserDefaults standardUserDefaults] setObject:name forKey:@"channel"];

  NSTask *awake = [NSTask new];
  awake.executableURL = [NSURL fileURLWithPath:@"/usr/bin/caffeinate"];
  awake.arguments = @[@"-i", @"-w", [NSString stringWithFormat:@"%d", task.processIdentifier]];
  if ([awake launchAndReturnError:nil]) self.caffeinate = awake;
}

// Validates h:mm:ss, m:ss or plain seconds. Empty is allowed (whole VOD).
- (BOOL)validVodTime:(NSString *)value {
  if (!value.length) return YES;
  return [[NSPredicate predicateWithFormat:@"SELF MATCHES %@", @"[0-9]+(:[0-5]?[0-9]){0,2}"] evaluateWithObject:value];
}

- (void)findHighlights:(id)sender {
  if (self.vodTask.running) {
    self.vodCancelled = YES;
    self.ui.vodButton.enabled = NO;
    self.status.stringValue = @"Cancelling…";
    [self.ui setSessionState:HDSessionStateStopping status:self.status.stringValue];
    [self.vodTask terminate];
    return;
  }
  if (self.task.running) {
    self.status.stringValue = @"Stop the live capture before scanning a VOD.";
    return;
  }
  NSString *blocked = [self newCaptureBlockReason];
  if (blocked) {
    self.status.stringValue = blocked;
    [self.ui setSessionState:HDSessionStateError status:blocked];
    [self showLicense:nil];
    return;
  }
  NSCharacterSet *space = [NSCharacterSet whitespaceAndNewlineCharacterSet];
  NSString *link = [self.ui.vodField.stringValue stringByTrimmingCharactersInSet:space];
  NSString *startText = [self.ui.vodStartField.stringValue stringByTrimmingCharactersInSet:space];
  NSString *endText = [self.ui.vodEndField.stringValue stringByTrimmingCharactersInSet:space];
  if (!link.length) {
    self.status.stringValue = @"Paste a Twitch VOD link, like twitch.tv/videos/123456789.";
    [self.ui setSessionState:HDSessionStateReady status:self.status.stringValue];
    return;
  }
  if (![self validVodTime:startText] || ![self validVodTime:endText]) {
    self.status.stringValue = @"Use h:mm:ss for Start and End, or leave them empty.";
    [self.ui setSessionState:HDSessionStateReady status:self.status.stringValue];
    return;
  }

  NSString *resource = NSBundle.mainBundle.resourcePath;
  NSString *script = [resource stringByAppendingPathComponent:@"vod.cjs"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:script]) {
    [self alert:@"ClipSpike is incomplete." info:@"vod.cjs is missing from the app bundle. Rebuild with mac/build.sh."];
    return;
  }
  NSArray<NSString *> *paths = [self searchPaths];
  NSString *node = [resource stringByAppendingPathComponent:@"node"];
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:node]) node = [self findTool:@"node" paths:paths];
  if (!node) {
    [self alert:@"Node.js was not found." info:@"Install Node 22 or newer, or rebuild the app with mac/build.sh so the bundled runtime is included."];
    return;
  }
  NSMutableArray<NSString *> *missing = [NSMutableArray array];
  for (NSString *tool in @[@"streamlink", @"ffmpeg"]) {
    if (![self findTool:tool paths:paths]) [missing addObject:tool];
  }
  if (missing.count) {
    [self alert:@"A recording dependency is missing."
           info:[NSString stringWithFormat:@"Install %@ with: brew install %@", [missing componentsJoinedByString:@" and "], [missing componentsJoinedByString:@" "]]];
    return;
  }

  NSInteger top = [self.ui vodTopCount];
  NSMutableArray<NSString *> *arguments = [NSMutableArray arrayWithObjects:script, link, @"--top", [NSString stringWithFormat:@"%ld", (long)top], nil];
  if (startText.length) [arguments addObjectsFromArray:@[@"--start", startText]];
  if (endText.length) [arguments addObjectsFromArray:@[@"--end", endText]];
  if (self.ui.vodCaptionsCheckbox.state == NSControlStateValueOn) [arguments addObject:@"--captions"];
  if (self.ui.vodHookCheckbox.state == NSControlStateValueOn) {
    [arguments addObject:@"--hook"];
    NSString *hookText = [self.ui.vodHookTextField.stringValue stringByTrimmingCharactersInSet:space];
    if (hookText.length) [arguments addObjectsFromArray:@[@"--hook-text", hookText]];
  }

  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:node];
  task.arguments = arguments;
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"PATH"] = [paths componentsJoinedByString:@":"];
  environment[@"CLIPSPIKE_EVENTS"] = @"1";
  [self applyStorageEnvironment:environment];
  NSString *preferredOutput = [[NSUserDefaults standardUserDefaults] stringForKey:@"HDOutputRoot"];
  if (preferredOutput.length) environment[@"CLIPSPIKE_OUTPUT"] = preferredOutput;
  task.environment = environment;

  NSPipe *stdoutPipe = [NSPipe pipe];
  NSPipe *stderrPipe = [NSPipe pipe];
  task.standardOutput = stdoutPipe;
  task.standardError = stderrPipe;
  self.vodStdoutBuffer = [NSMutableString string];
  self.lastError = nil;

  __weak typeof(self) weakSelf = self;
  stdoutPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length) return;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) return;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf consumeVodStdout:text]; });
  };
  stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length) return;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) return;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf consumeStderr:text]; });
  };

  task.terminationHandler = ^(NSTask *finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (weakSelf.vodTask != finished) return;
      weakSelf.vodTask = nil;
      weakSelf.caffeinate = nil;
      weakSelf.ui.vodButton.enabled = YES;
      [weakSelf.ui setVodRunning:NO];
      int code = finished.terminationStatus;
      if (weakSelf.vodCancelled) {
        weakSelf.status.stringValue = [NSString stringWithFormat:@"Cancelled · %ld clip%@ saved", (long)weakSelf.vodSaved, weakSelf.vodSaved == 1 ? @"" : @"s"];
        [weakSelf.ui setSessionState:HDSessionStateReady status:weakSelf.status.stringValue];
      } else if (code == 0) {
        [weakSelf.ui setSessionState:HDSessionStateReady status:weakSelf.status.stringValue];
      } else if (!weakSelf.vodFatal) {
        weakSelf.status.stringValue = weakSelf.lastError.length ? [NSString stringWithFormat:@"VOD scan exited: %@", weakSelf.lastError] : @"VOD scan exited. Check that Streamlink and FFmpeg are installed.";
        [weakSelf.ui setSessionState:HDSessionStateError status:weakSelf.status.stringValue];
      }
      weakSelf.lastClipButton.enabled = weakSelf.lastClipPath.length > 0;
      [weakSelf.ui updateSummaryWithClips:weakSelf.clipCount queue:weakSelf.queuedCount storage:weakSelf.storageLabel trial:weakSelf.trialDays];
      [weakSelf logUsageEvent:@"vod-exit" details:@{@"status": @(code), @"clips": @(weakSelf.vodSaved), @"cancelled": @(weakSelf.vodCancelled)}];
    });
  };

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    self.status.stringValue = error.localizedDescription;
    [self alert:@"Could not start the VOD scan." info:error.localizedDescription];
    return;
  }
  self.vodTask = task;
  self.vodCancelled = NO;
  self.vodFatal = NO;
  self.vodMomentCount = 0;
  self.vodRequested = 0;
  self.vodSaved = 0;
  self.clipCount = 0;
  [self logUsageEvent:@"vod-start" details:@{@"top": @(top), @"start": startText, @"end": endText}];
  [self.ui setVodRunning:YES];
  self.status.stringValue = @"Looking up the VOD…";
  self.telemetry.stringValue = @"";
  [self.ui setSessionState:HDSessionStateLive status:self.status.stringValue];
  [self.ui updateSummaryWithClips:self.clipCount queue:self.queuedCount storage:self.storageLabel trial:self.trialDays];

  NSTask *awake = [NSTask new];
  awake.executableURL = [NSURL fileURLWithPath:@"/usr/bin/caffeinate"];
  awake.arguments = @[@"-i", @"-w", [NSString stringWithFormat:@"%d", task.processIdentifier]];
  if ([awake launchAndReturnError:nil]) self.caffeinate = awake;
}

- (void)saveHighlight:(id)sender {
  if (!self.task.running) return;
  kill(self.task.processIdentifier, SIGUSR2);
  self.status.stringValue = @"Saving the last 30 seconds…";
}

- (void)openLastClip:(id)sender {
  if (!self.lastClipPath.length) return;
  [self logFeedbackAction:@"opened" clipId:self.lastClipId details:@{@"from": @"last-clip"}];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:self.lastClipPath]];
}

- (void)chooseOutputFolder:(id)sender {
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseDirectories = YES; panel.canChooseFiles = NO; panel.canCreateDirectories = YES;
  panel.prompt = @"Choose Folder";
  [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
    if (result != NSModalResponseOK) return;
    [[NSUserDefaults standardUserDefaults] setObject:panel.URL.path forKey:@"HDOutputRoot"];
    [self.ui setLocalOutputPath:panel.URL.path];
    if (self.task.running) [self alert:@"Folder saved" info:@"The new folder will be used the next time capture starts."];
  }];
}

- (void)folder:(id)sender {
  NSString *preferred = [[NSUserDefaults standardUserDefaults] stringForKey:@"HDOutputRoot"];
  NSString *path = preferred.length ? preferred : (self.outputPath.length ? self.outputPath : [HDMigration defaultOutputPath]);
  [[NSFileManager defaultManager] createDirectoryAtPath:path withIntermediateDirectories:YES attributes:nil error:nil];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
}

- (void)site:(id)sender {
  [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kDashboardURL]];
}

- (void)openDropbox:(id)sender {
  [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kDropboxHomeURL]];
}

- (void)openStorage:(id)sender {
  if (self.lastRemoteURL.length) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:self.lastRemoteURL]];
    return;
  }
  if ([self.storageMode isEqualToString:@"local"]) {
    [self folder:sender];
    return;
  }
  if ([self.storageMode isEqualToString:@"googleDrive"]) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:kGoogleDriveHomeURL]];
    return;
  }
  [self openDropbox:sender];
}

- (void)mergeConfigDefaultsAtPath:(NSString *)path {
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) return;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:&error];
  if (![parsed isKindOfClass:[NSMutableDictionary class]]) return;
  NSMutableDictionary *config = (NSMutableDictionary *)parsed;

  NSMutableDictionary *reframe = [config[@"reframe"] isKindOfClass:[NSMutableDictionary class]] ? config[@"reframe"] : [NSMutableDictionary dictionary];
  if (!reframe[@"encoder"]) reframe[@"encoder"] = @"h264_videotoolbox";
  if (!reframe[@"bitrate"]) reframe[@"bitrate"] = @"8M";
  config[@"reframe"] = reframe;

  NSMutableDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSMutableDictionary class]] ? config[@"dropbox"] : nil;
  NSString *folder = [dropbox[@"folder"] isKindOfClass:[NSString class]] ? dropbox[@"folder"] : @"/ClipSpike";
  NSMutableDictionary *storage = [config[@"storage"] isKindOfClass:[NSMutableDictionary class]] ? config[@"storage"] : [NSMutableDictionary dictionary];
  if (!storage[@"mode"]) {
    BOOL dropboxReady = dropbox && (([dropbox[@"appKey"] isKindOfClass:[NSString class]] && [dropbox[@"appKey"] length] > 0)
      || ([dropbox[@"refreshToken"] isKindOfClass:[NSString class]] && [dropbox[@"refreshToken"] length] > 0));
    storage[@"mode"] = dropboxReady ? @"dropbox" : @"local";
  }
  if (!storage[@"folder"]) storage[@"folder"] = folder;
  if (!storage[@"deleteAfterUpload"]) storage[@"deleteAfterUpload"] = @YES;
  if (!storage[@"keepLocalCopy"]) storage[@"keepLocalCopy"] = @NO;
  if (!storage[@"keepRaw"]) storage[@"keepRaw"] = @NO;
  config[@"storage"] = storage;

  NSMutableDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSMutableDictionary class]] ? config[@"googleDrive"] : [NSMutableDictionary dictionary];
  if (!google[@"enabled"]) google[@"enabled"] = @YES;
  if (!google[@"folder"]) google[@"folder"] = folder;
  config[@"googleDrive"] = google;

  NSData *output = [NSJSONSerialization dataWithJSONObject:config options:NSJSONWritingPrettyPrinted error:&error];
  if (output) {
    [output writeToFile:path atomically:YES];
    [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:path error:nil];
  }
}

- (NSString *)selectedStorageMode {
  switch (self.storageModePopup.indexOfSelectedItem) {
    case 1: return @"dropbox";
    case 2: return @"googleDrive";
    default: return @"local";
  }
}

- (void)updateStorageStatus {
  NSString *mode = [self selectedStorageMode];
  [self.ui syncStorageVisibility];
  if ([mode isEqualToString:@"local"]) {
    self.storageStatus.stringValue = @"Clips stay on this Mac. No account is required.";
    self.storageConnectButton.enabled = NO;
    self.storageConnectButton.hidden = YES;
    self.storageDisconnectButton.enabled = NO;
    self.storageDisconnectButton.hidden = YES;
    self.storageFolder.enabled = NO;
    self.storageDeleteCheckbox.enabled = NO;

    self.storageKeepLocalCheckbox.enabled = NO;

    self.storageKeepRawCheckbox.enabled = YES;
    return;
  }
  NSString *token = [self tokenForMode:mode];
  NSString *account = [self accountForMode:mode];
  NSString *label = [mode isEqualToString:@"dropbox"] ? @"Dropbox" : @"Google Drive";
  if (token.length) {
    self.storageStatus.stringValue = account.length
      ? [NSString stringWithFormat:@"Connected to %@ as %@.", label, account]
      : [NSString stringWithFormat:@"Connected to %@.", label];
    self.storageConnectButton.title = @"Reconnect";
    self.storageDisconnectButton.enabled = YES;
  } else {
    self.storageStatus.stringValue = [NSString stringWithFormat:@"%@ is not connected. Click Connect to open the browser.", label];
    self.storageConnectButton.title = @"Connect";
    self.storageDisconnectButton.enabled = NO;
  }
  self.storageConnectButton.hidden = NO;
  self.storageDisconnectButton.hidden = NO;
  self.storageFolder.enabled = YES;
  self.storageDeleteCheckbox.enabled = YES;
  self.storageKeepLocalCheckbox.enabled = YES;
  self.storageKeepRawCheckbox.enabled = YES;
  self.storageConnectButton.enabled = !(self.oauthTask && self.oauthTask.running);
}

- (void)reloadStorageSettings {
  NSMutableDictionary *config = [self loadConfig];
  NSDictionary *storage = [config[@"storage"] isKindOfClass:[NSDictionary class]] ? config[@"storage"] : nil;
  NSString *mode = [storage[@"mode"] isKindOfClass:[NSString class]] ? storage[@"mode"] : @"local";
  NSInteger index = [mode isEqualToString:@"dropbox"] ? 1 : [mode isEqualToString:@"googleDrive"] ? 2 : 0;
  [self.storageModePopup selectItemAtIndex:index];
  NSString *folder = [storage[@"folder"] isKindOfClass:[NSString class]] ? storage[@"folder"] : @"/ClipSpike";
  self.storageFolder.stringValue = folder;
  self.storageDeleteCheckbox.state = [storage[@"deleteAfterUpload"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
  self.storageKeepLocalCheckbox.state = ([storage[@"keepLocalCopy"] boolValue] || (storage[@"deleteAfterUpload"] && ![storage[@"deleteAfterUpload"] boolValue])) ? NSControlStateValueOn : NSControlStateValueOff;
  self.storageKeepRawCheckbox.state = [storage[@"keepRaw"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
  [self updateStorageStatus];
  NSDictionary *reframe = [config[@"reframe"] isKindOfClass:[NSDictionary class]] ? config[@"reframe"] : nil;
  NSNumber *ratio = [reframe[@"camHeightRatio"] isKindOfClass:[NSNumber class]] ? reframe[@"camHeightRatio"] : @0.35;
  [self.ui setReframeLayout:[reframe[@"layout"] isKindOfClass:[NSString class]] ? reframe[@"layout"] : @"blur"
              camHeightRatio:ratio.doubleValue
               facecamCorner:[reframe[@"facecamCorner"] isKindOfClass:[NSString class]] ? reframe[@"facecamCorner"] : @"bottom-left"];
  if (self.ui) { [self.ui syncStorageCards]; self.ui.storageSaveButton.enabled = NO; }
}

- (void)storagePreferencesChanged:(id)sender { self.ui.storageSaveButton.enabled = YES; }

- (void)storageModeChanged:(id)sender {
  self.ui.storageSaveButton.enabled = YES;
  [self updateStorageStatus];
  if (self.ui) [self.ui syncStorageCards];
}

- (void)showStorageSettings:(id)sender {
  if (self.ui) { [self.ui selectPage:HDPageStorage]; [self reloadStorageSettings]; return; }
  if (!self.storageWindow) {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 560, 430)
                                                   styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"Storage";
    window.releasedWhenClosed = NO;
    NSView *view = window.contentView;

    NSTextField *heading = [NSTextField labelWithString:@"Where should clips go?"];
    heading.font = [NSFont boldSystemFontOfSize:20];
    heading.frame = NSMakeRect(24, 378, 512, 26);
    [view addSubview:heading];

    self.storageModePopup = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(24, 340, 300, 28) pullsDown:NO];
    [self.storageModePopup addItemsWithTitles:@[@"Local only", @"Dropbox", @"Google Drive"]];
    self.storageModePopup.target = self;
    self.storageModePopup.action = @selector(storageModeChanged:);
    [view addSubview:self.storageModePopup];

    self.storageStatus = [NSTextField wrappingLabelWithString:@""];
    self.storageStatus.frame = NSMakeRect(24, 292, 512, 38);
    [view addSubview:self.storageStatus];

    self.storageConnectButton = [NSButton buttonWithTitle:@"Connect" target:self action:@selector(connectStorage:)];
    self.storageConnectButton.frame = NSMakeRect(24, 252, 120, 32);
    [view addSubview:self.storageConnectButton];

    self.storageDisconnectButton = [NSButton buttonWithTitle:@"Disconnect" target:self action:@selector(disconnectStorage:)];
    self.storageDisconnectButton.frame = NSMakeRect(152, 252, 120, 32);
    [view addSubview:self.storageDisconnectButton];

    NSButton *json = [NSButton buttonWithTitle:@"Edit config file" target:self action:@selector(openConfig:)];
    json.frame = NSMakeRect(288, 252, 150, 32);
    [view addSubview:json];

    NSTextField *folderLabel = [NSTextField labelWithString:@"Remote folder"];
    folderLabel.frame = NSMakeRect(24, 220, 110, 18);
    [view addSubview:folderLabel];

    self.storageFolder = [NSTextField textFieldWithString:@"/ClipSpike"];
    self.storageFolder.frame = NSMakeRect(136, 214, 400, 26);
    [view addSubview:self.storageFolder];

    self.storageDeleteCheckbox = [NSButton checkboxWithTitle:@"Delete local videos after a confirmed upload" target:nil action:nil];
    self.storageDeleteCheckbox.frame = NSMakeRect(24, 180, 480, 22);
    [view addSubview:self.storageDeleteCheckbox];

    self.storageKeepLocalCheckbox = [NSButton checkboxWithTitle:@"Keep a local copy after uploading" target:nil action:nil];
    self.storageKeepLocalCheckbox.frame = NSMakeRect(24, 154, 480, 22);
    [view addSubview:self.storageKeepLocalCheckbox];

    self.storageKeepRawCheckbox = [NSButton checkboxWithTitle:@"Keep the landscape intermediate" target:nil action:nil];
    self.storageKeepRawCheckbox.frame = NSMakeRect(24, 128, 480, 22);
    [view addSubview:self.storageKeepRawCheckbox];

    NSTextField *note = [NSTextField wrappingLabelWithString:@"Tokens are stored in Keychain. Connect opens your browser; no Terminal steps are required once the vendor OAuth client is configured."];
    note.font = [NSFont systemFontOfSize:11];
    note.textColor = [NSColor secondaryLabelColor];
    note.frame = NSMakeRect(24, 74, 512, 38);
    [view addSubview:note];

    NSButton *save = [NSButton buttonWithTitle:@"Save" target:self action:@selector(saveStorageSettings:)];
    save.frame = NSMakeRect(24, 24, 100, 32);
    save.keyEquivalent = @"\r";
    [view addSubview:save];

    NSButton *done = [NSButton buttonWithTitle:@"Done" target:self action:@selector(closeStorageSettings:)];
    done.frame = NSMakeRect(132, 24, 100, 32);
    [view addSubview:done];

    self.storageWindow = window;
    [self reloadStorageSettings];
    [window center];
  } else {
    [self reloadStorageSettings];
  }
  [self.storageWindow makeKeyAndOrderFront:nil];
}

- (void)closeStorageSettings:(id)sender {
  [self.storageWindow close];
}

- (void)saveStorageSettings:(id)sender {
  NSMutableDictionary *config = [self loadConfig];
  if (!config) return;
  NSMutableDictionary *storage = [config[@"storage"] isKindOfClass:[NSMutableDictionary class]] ? config[@"storage"] : [NSMutableDictionary dictionary];
  storage[@"mode"] = [self selectedStorageMode];
  storage[@"folder"] = self.storageFolder.stringValue.length ? self.storageFolder.stringValue : @"/ClipSpike";
  if (![[self selectedStorageMode] isEqualToString:@"local"]) {
    BOOL keep = self.storageKeepLocalCheckbox.state == NSControlStateValueOn;
    storage[@"deleteAfterUpload"] = @(!keep);
    storage[@"keepLocalCopy"] = @(keep);
  }
  storage[@"keepRaw"] = @(self.storageKeepRawCheckbox.state == NSControlStateValueOn);
  config[@"storage"] = storage;
  if (![self writeConfig:config]) {
    [self alert:@"Could not save storage settings." info:self.configPath];
    return;
  }
  [self reloadStorageSettings];
  self.status.stringValue = self.task.running
    ? @"Storage settings saved. Restart capture to apply them."
    : @"Storage settings saved.";
  if (self.task.running) {
    [self alert:@"Restart capture" info:@"Stop and start capture to use the new storage destination."];
  }
}

- (NSString *)clientIdForMode:(NSString *)mode {
  NSMutableDictionary *config = [self loadConfig];
  if ([mode isEqualToString:@"dropbox"]) {
    NSDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSDictionary class]] ? config[@"dropbox"] : nil;
    return [self infoOrEnvironment:@"HDDropboxAppKey" environment:@"CLIPSPIKE_DROPBOX_APP_KEY" fallback:dropbox[@"appKey"]];
  }
  NSDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSDictionary class]] ? config[@"googleDrive"] : nil;
  return [self infoOrEnvironment:@"HDGoogleClientId" environment:@"CLIPSPIKE_GOOGLE_CLIENT_ID" fallback:google[@"clientId"]];
}

- (NSString *)clientSecretForMode:(NSString *)mode {
  NSMutableDictionary *config = [self loadConfig];
  NSDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSDictionary class]] ? config[@"googleDrive"] : nil;
  return [self infoOrEnvironment:@"HDGoogleClientSecret" environment:@"CLIPSPIKE_GOOGLE_CLIENT_SECRET" fallback:google[@"clientSecret"]];
}

- (void)connectStorage:(id)sender {
  NSString *mode = [self selectedStorageMode];
  if ([mode isEqualToString:@"local"]) return;
  if (self.oauthTask && self.oauthTask.running) return;

  NSString *clientId = [self clientIdForMode:mode];
  NSString *clientSecret = [self clientSecretForMode:mode];
  if (!clientId.length) {
    [self alert:@"OAuth client not configured"
           info:[NSString stringWithFormat:@"Set %@ in Info.plist or the build environment. See docs/RELEASE.md.", [mode isEqualToString:@"dropbox"] ? @"HDDropboxAppKey" : @"HDGoogleClientId"]];
    return;
  }
  if ([mode isEqualToString:@"googleDrive"] && !clientSecret.length) {
    [self alert:@"Google OAuth client secret missing" info:@"Set HDGoogleClientSecret in Info.plist or the build environment. See docs/RELEASE.md."];
    return;
  }

  NSString *resource = NSBundle.mainBundle.resourcePath;
  NSString *bridge = [resource stringByAppendingPathComponent:@"tools/oauth-bridge.js"];
  NSString *node = [resource stringByAppendingPathComponent:@"node"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:bridge]) {
    [self alert:@"OAuth helper missing" info:@"Rebuild the app with mac/build.sh."];
    return;
  }
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:node]) {
    node = [self findTool:@"node" paths:[self searchPaths]];
  }
  if (!node) {
    [self alert:@"Node.js not found" info:@"Rebuild the app with mac/build.sh."];
    return;
  }

  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:node];
  NSString *provider = [mode isEqualToString:@"googleDrive"] ? @"google" : @"dropbox";
  task.arguments = @[bridge, @"--provider", provider, @"--client-id", clientId];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"PATH"] = [[self searchPaths] componentsJoinedByString:@":"];
  if (clientSecret.length) environment[@"OAUTH_CLIENT_SECRET"] = clientSecret;
  task.environment = environment;

  NSPipe *stdoutPipe = [NSPipe pipe];
  NSPipe *stderrPipe = [NSPipe pipe];
  task.standardOutput = stdoutPipe;
  task.standardError = stderrPipe;
  self.oauthOutput = [NSMutableData data];
  self.oauthTask = task;
  self.storageStatus.stringValue = @"Complete the authorization in your browser…";
  self.storageConnectButton.enabled = NO;

  __weak typeof(self) weakSelf = self;
  stdoutPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length || !weakSelf.oauthOutput) return;
    @synchronized(weakSelf.oauthOutput) { [weakSelf.oauthOutput appendData:data]; }
  };
  stderrPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    (void)handle.availableData;
  };
  task.terminationHandler = ^(NSTask *finished) {
    NSData *remaining = [[finished.standardOutput fileHandleForReading] readDataToEndOfFile];
    if (remaining.length) {
      @synchronized(weakSelf.oauthOutput) {
        if (weakSelf.oauthOutput) [weakSelf.oauthOutput appendData:remaining];
      }
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf finishOAuth:finished]; });
  };

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    self.oauthTask = nil;
    [self alert:@"Could not connect storage" info:error.localizedDescription];
    [self updateStorageStatus];
  }
}

- (void)finishOAuth:(NSTask *)task {
  self.oauthTask = nil;
  NSData *data = self.oauthOutput ? [self.oauthOutput copy] : [NSData data];
  self.oauthOutput = nil;
  NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
  NSDictionary *result = nil;
  for (NSString *line in [[text componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]] reverseObjectEnumerator]) {
    NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (![trimmed hasPrefix:@"{"]) continue;
    NSData *lineData = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil];
    if ([parsed isKindOfClass:[NSDictionary class]]) { result = parsed; break; }
  }
  if (![result[@"ok"] boolValue]) {
    NSString *message = [result[@"error"] isKindOfClass:[NSString class]] ? result[@"error"] : @"The browser authorization did not complete.";
    [self updateStorageStatus];
    [self alert:@"Could not connect storage" info:message];
    return;
  }

  NSString *provider = [result[@"provider"] isKindOfClass:[NSString class]] ? result[@"provider"] : [self selectedStorageMode];
  NSString *refreshToken = [result[@"refreshToken"] isKindOfClass:[NSString class]] ? result[@"refreshToken"] : @"";
  NSString *account = [result[@"account"] isKindOfClass:[NSString class]] ? result[@"account"] : @"";
  NSString *displayName = [result[@"displayName"] isKindOfClass:[NSString class]] ? result[@"displayName"] : @"";
  NSString *keychainAccount = [provider isEqualToString:@"googleDrive"] ? @"google.refresh" : @"dropbox.refresh";
  if (!refreshToken.length) {
    [self updateStorageStatus];
    [self alert:@"Could not save the connection" info:@"The provider did not return a refresh token."];
    return;
  }
  BOOL keychainStored = HDKeychainSet(keychainAccount, refreshToken);

  NSMutableDictionary *config = [self loadConfig];
  if ([provider isEqualToString:@"googleDrive"]) {
    NSMutableDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSMutableDictionary class]] ? config[@"googleDrive"] : [NSMutableDictionary dictionary];
    google[@"email"] = account.length ? account : displayName;
    google[@"refreshToken"] = keychainStored ? @"" : refreshToken;
    config[@"googleDrive"] = google;
  } else {
    NSMutableDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSMutableDictionary class]] ? config[@"dropbox"] : [NSMutableDictionary dictionary];
    dropbox[@"account"] = account.length ? account : displayName;
    dropbox[@"refreshToken"] = keychainStored ? @"" : refreshToken;
    config[@"dropbox"] = dropbox;
  }
  NSMutableDictionary *storage = [config[@"storage"] isKindOfClass:[NSMutableDictionary class]] ? config[@"storage"] : [NSMutableDictionary dictionary];
  storage[@"mode"] = provider;
  config[@"storage"] = storage;
  [self writeConfig:config];
  [self reloadStorageSettings];
  [self alert:@"Storage connected"
         info:[NSString stringWithFormat:@"%@ is connected. %@%@", [provider isEqualToString:@"googleDrive"] ? @"Google Drive" : @"Dropbox", self.task.running ? @"Restart capture to start uploading. " : @"Start capture when ready. ", keychainStored ? @"" : @"Keychain was unavailable, so the token was saved in the 0600 config file as a fallback."]];
}

- (void)disconnectStorage:(id)sender {
  NSString *mode = [self selectedStorageMode];
  if ([mode isEqualToString:@"local"]) return;
  NSString *keychainAccount = [mode isEqualToString:@"googleDrive"] ? @"google.refresh" : @"dropbox.refresh";
  HDKeychainDelete(keychainAccount);
  NSMutableDictionary *config = [self loadConfig];
  if ([mode isEqualToString:@"googleDrive"]) {
    NSMutableDictionary *google = [config[@"googleDrive"] isKindOfClass:[NSMutableDictionary class]] ? config[@"googleDrive"] : [NSMutableDictionary dictionary];
    google[@"email"] = @"";
    google[@"refreshToken"] = @"";
    config[@"googleDrive"] = google;
  } else {
    NSMutableDictionary *dropbox = [config[@"dropbox"] isKindOfClass:[NSMutableDictionary class]] ? config[@"dropbox"] : [NSMutableDictionary dictionary];
    dropbox[@"account"] = @"";
    dropbox[@"refreshToken"] = @"";
    config[@"dropbox"] = dropbox;
  }
  [self writeConfig:config];
  [self updateStorageStatus];
}

- (void)openConfig:(id)sender {
  NSString *path = self.configPath.length ? self.configPath : [NSHomeDirectory() stringByAppendingPathComponent:@".clipspike.json"];
  NSFileManager *manager = [NSFileManager defaultManager];
  BOOL created = NO;
  if (![manager fileExistsAtPath:path]) {
    [manager createDirectoryAtPath:[path stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
    NSData *data = [kConfigTemplate dataUsingEncoding:NSUTF8StringEncoding];
    created = [manager createFileAtPath:path contents:data attributes:@{NSFilePosixPermissions: @0600}];
    if (!created) {
      [self alert:@"Could not create the storage setup file." info:path];
      return;
    }
  }
  [manager setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:path error:nil];
  if (!created) [self mergeConfigDefaultsAtPath:path];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
  if (created) {
    [self alert:@"Storage setup file created."
           info:@"Set storage.mode to local, dropbox, or googleDrive. For Dropbox, run `npm run dropbox:auth`; for Google Drive, add clientId/clientSecret and run `npm run google:auth`. Restart capture afterward."];
  } else {
    [self alert:@"Storage settings"
           info:@"Edit storage.mode and the selected provider, save, then restart capture. Use `npm run dropbox:auth` or `npm run google:auth` to refresh credentials."];
  }
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
  if (self.vodTask.running && !self.task.running) {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Still finding highlights.";
    alert.informativeText = @"Cancel the VOD scan and quit ClipSpike?";
    [alert addButtonWithTitle:@"Cancel Scan and Quit"];
    [alert addButtonWithTitle:@"Keep Running"];
    if ([alert runModal] != NSAlertFirstButtonReturn) return NO;
    self.quitting = YES;
    [self.vodTask terminate];
  }
  if (self.task.running) {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Capture is still running.";
    alert.informativeText = @"Stop recording and quit ClipSpike?";
    [alert addButtonWithTitle:@"Stop and Quit"];
    [alert addButtonWithTitle:@"Keep Running"];
    if ([alert runModal] != NSAlertFirstButtonReturn) return NO;
    self.quitting = YES;
    [self.task terminate];
  }
  return YES;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)application {
  return YES;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)application hasVisibleWindows:(BOOL)visible {
  [self.window makeKeyAndOrderFront:nil];
  return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  self.quitting = YES;
  [self.statusTimer invalidate];
  if (self.statusItem) [NSStatusBar.systemStatusBar removeStatusItem:self.statusItem];
  if (self.task.running) [self.task terminate];
  if (self.vodTask.running) [self.vodTask terminate];
}

@end

int main() {
  @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    Desk *delegate = [Desk new];
    app.delegate = delegate;
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    [app run];
    (void)delegate;
  }
  return 0;
}
