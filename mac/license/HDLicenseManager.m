#import "HDLicenseManager.h"
#import "HDKeychain.h"
#import <IOKit/IOKitLib.h>

static NSString *const kLicenseService = @"com.chatclip.app.license";
static NSString *const kAccountKey = @"license_key";
static NSString *const kAccountInstance = @"instance_id";
static NSString *const kAccountValidated = @"last_validated_timestamp";

const NSTimeInterval HDLicenseGraceInterval = 14 * 24 * 60 * 60;

@interface HDLicenseManager ()
@property(nonatomic, readwrite) HDLicenseStanding state;
@property(nonatomic) BOOL stateComputed;
// With the Keychain disabled (tests/CI) values live here for the process only.
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *memory;
@end

@implementation HDLicenseManager

- (instancetype)init {
  if ((self = [super init])) {
    _memory = [NSMutableDictionary dictionary];
    _state = HDLicenseStandingUnlicensed;
  }
  return self;
}

#pragma mark - Hardware identity

+ (NSString *)hardwareUUID {
  io_service_t platform = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"));
  if (platform == IO_OBJECT_NULL) return @"";
  CFTypeRef value = IORegistryEntryCreateCFProperty(platform, CFSTR(kIOPlatformUUIDKey), kCFAllocatorDefault, 0);
  IOObjectRelease(platform);
  if (!value) return @"";
  NSString *uuid = CFGetTypeID(value) == CFStringGetTypeID() ? [(__bridge NSString *)value copy] : @"";
  CFRelease(value);
  return uuid ?: @"";
}

+ (NSString *)instanceName {
  NSString *host = [[NSHost currentHost] localizedName] ?: @"Mac";
  NSString *uuid = [self hardwareUUID];
  return uuid.length ? [NSString stringWithFormat:@"%@ - %@", host, uuid] : [NSString stringWithFormat:@"%@ - ChatClip", host];
}

#pragma mark - Storage

- (NSString *)read:(NSString *)account {
  if ([HDKeychain isDisabled]) return self.memory[account] ?: @"";
  return [HDKeychain stringForAccount:account service:kLicenseService] ?: @"";
}

- (void)write:(NSString *)value account:(NSString *)account {
  if ([HDKeychain isDisabled]) { self.memory[account] = value; return; }
  [HDKeychain setString:value forAccount:account service:kLicenseService];
}

- (NSString *)licenseKey { return [self read:kAccountKey]; }
- (NSString *)instanceId { return [self read:kAccountInstance]; }

- (NSDate *)lastValidated {
  NSString *raw = [self read:kAccountValidated];
  if (!raw.length) return nil;
  return [NSDate dateWithTimeIntervalSince1970:raw.doubleValue];
}

- (BOOL)hasCredentials {
  return self.licenseKey.length > 0 && self.instanceId.length > 0;
}

- (BOOL)isWithinGrace {
  NSDate *date = self.lastValidated;
  if (!date) return NO;
  NSTimeInterval age = [[NSDate date] timeIntervalSinceDate:date];
  // A clock set far into the past must not extend the grace window forever.
  return age >= -300 && age <= HDLicenseGraceInterval;
}

- (void)stampNow {
  [self write:[NSString stringWithFormat:@"%.0f", [[NSDate date] timeIntervalSince1970]] account:kAccountValidated];
}

#pragma mark - Mutations

- (void)migrateLegacyKey:(NSString *)key instanceId:(NSString *)instanceId lastValidated:(NSDate *)date {
  if (self.hasCredentials || !key.length || !instanceId.length) return;
  [self write:key account:kAccountKey];
  [self write:instanceId account:kAccountInstance];
  if (date) [self write:[NSString stringWithFormat:@"%.0f", date.timeIntervalSince1970] account:kAccountValidated];
  [self refresh];
}

- (void)recordActivationWithKey:(NSString *)key instanceId:(NSString *)instanceId {
  if (!key.length || !instanceId.length) return;
  [self write:key account:kAccountKey];
  [self write:instanceId account:kAccountInstance];
  [self stampNow];
  [self refresh];
}

- (void)recordValidation {
  if (!self.hasCredentials) return;
  [self stampNow];
  [self refresh];
}

- (void)clear {
  [self.memory removeAllObjects];
  [HDKeychain deleteAccount:kAccountKey service:kLicenseService];
  [HDKeychain deleteAccount:kAccountInstance service:kLicenseService];
  [HDKeychain deleteAccount:kAccountValidated service:kLicenseService];
  [self refresh];
}

#pragma mark - State

- (HDLicenseStanding)computeState {
  if (!self.hasCredentials) return HDLicenseStandingUnlicensed;
  return self.isWithinGrace ? HDLicenseStandingValid : HDLicenseStandingStale;
}

- (void)refresh {
  HDLicenseStanding next = [self computeState];
  BOOL changed = !self.stateComputed || next != self.state;
  self.stateComputed = YES;
  self.state = next;
  if (changed && self.onStateChange) {
    void (^handler)(HDLicenseStanding) = self.onStateChange;
    if ([NSThread isMainThread]) handler(next);
    else dispatch_async(dispatch_get_main_queue(), ^{ handler(next); });
  }
}

@end
