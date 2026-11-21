#import "HDMigration.h"
#import "../license/HDKeychain.h"
#import <Security/Security.h>

static NSString *const kDoneKey = @"HDLegacyMigrationV1";
// Pre-rename names, newest first: "ChatClip", then "Highlight Desk".
static NSArray<NSString *> *LegacyDefaultsDomains(void) { return @[@"com.chatclip.app", @"com.highlightdesk.app"]; }
static NSArray<NSString *> *LegacyConfigNames(void) { return @[@".chatclip.json", @".highlight-desk.json"]; }
static NSArray<NSString *> *LegacyAppNames(void) { return @[@"ChatClip", @"Highlight Desk"]; }
static NSArray<NSString *> *LegacyEnvPrefixes(void) { return @[@"CHATCLIP_", @"HIGHLIGHT_DESK_"]; }
static NSString *const kServiceSuffixes[] = {@"credentials", @"license"};

NSString *HDEnv(NSString *name) {
  NSDictionary *env = NSProcessInfo.processInfo.environment;
  NSString *value = env[name];
  if (value.length || ![name hasPrefix:@"CLIPSPIKE_"]) return value;
  for (NSString *prefix in LegacyEnvPrefixes()) {
    NSString *old = env[[prefix stringByAppendingString:[name substringFromIndex:10]]];
    if (old.length) return old;
  }
  return value;
}

@implementation HDMigration

+ (NSString *)defaultOutputPath {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *current = [NSHomeDirectory() stringByAppendingPathComponent:@"Movies/ClipSpike"];
  if ([fm fileExistsAtPath:current]) return current;
  for (NSString *name in LegacyAppNames()) {
    NSString *legacy = [NSHomeDirectory() stringByAppendingPathComponent:[@"Movies" stringByAppendingPathComponent:name]];
    if ([fm fileExistsAtPath:legacy]) return legacy;
  }
  return current;
}

+ (BOOL)copyDefaults {
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  for (NSString *domain in LegacyDefaultsDomains()) {
    if ([NSBundle.mainBundle.bundleIdentifier isEqualToString:domain]) continue;
    NSDictionary *old = [defaults persistentDomainForName:domain];
    for (NSString *key in old) {
      // The old app's "migrated" flag must not mark this migration as finished.
      if ([key isEqualToString:kDoneKey]) continue;
      if ([defaults objectForKey:key] == nil) [defaults setObject:old[key] forKey:key];
    }
  }
  return YES;
}

+ (BOOL)copyConfig {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *to = [NSHomeDirectory() stringByAppendingPathComponent:@".clipspike.json"];
  if ([fm fileExistsAtPath:to]) return YES;
  NSString *from = nil;
  for (NSString *name in LegacyConfigNames()) {
    NSString *candidate = [NSHomeDirectory() stringByAppendingPathComponent:name];
    if ([fm fileExistsAtPath:candidate]) { from = candidate; break; }
  }
  if (!from) return YES;
  NSString *draft = [to stringByAppendingString:@".partial"];
  [fm removeItemAtPath:draft error:nil];
  NSData *data = [NSData dataWithContentsOfFile:from];
  if (!data || ![data writeToFile:draft options:NSDataWritingAtomic error:nil]) return NO;
  [fm setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:draft error:nil];
  if (![[NSData dataWithContentsOfFile:draft] isEqualToData:data]) { [fm removeItemAtPath:draft error:nil]; return NO; }
  return [fm moveItemAtPath:draft toPath:to error:nil];
}

// Renames the old folder (atomic, nothing lost). If the new folder already exists,
// only items missing from it are moved. If a rename fails the item is copied and
// the original is left in place.
+ (BOOL)moveItem:(NSString *)from to:(NSString *)to {
  NSFileManager *fm = NSFileManager.defaultManager;
  if ([fm moveItemAtPath:from toPath:to error:nil]) return YES;
  return [fm copyItemAtPath:from toPath:to error:nil];
}

+ (BOOL)moveStateDirectory {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *base = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support"];
  NSString *to = [base stringByAppendingPathComponent:@"ClipSpike"];
  BOOL ok = YES;
  for (NSString *legacyName in LegacyAppNames()) {
    NSString *from = [base stringByAppendingPathComponent:legacyName];
    BOOL isDir = NO;
    if (![fm fileExistsAtPath:from isDirectory:&isDir] || !isDir) continue;
    if (![fm fileExistsAtPath:to]) { ok = [self moveItem:from to:to] && ok; continue; }
    for (NSString *name in [fm contentsOfDirectoryAtPath:from error:nil]) {
      NSString *target = [to stringByAppendingPathComponent:name];
      if ([fm fileExistsAtPath:target]) continue;
      ok = [self moveItem:[from stringByAppendingPathComponent:name] to:target] && ok;
    }
  }
  return ok;
}

+ (BOOL)copyKeychainService:(NSString *)from to:(NSString *)to {
  NSDictionary *query = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: from,
    (__bridge id)kSecReturnAttributes: @YES,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll
  };
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) return YES;
  if (status != errSecSuccess || !result) return NO;
  NSArray *items = (__bridge_transfer NSArray *)result;
  BOOL ok = YES;
  for (NSDictionary *item in items) {
    NSString *account = item[(__bridge id)kSecAttrAccount];
    if (![account isKindOfClass:NSString.class] || !account.length) continue;
    if ([HDKeychain stringForAccount:account service:to].length) continue;
    NSString *value = [HDKeychain stringForAccount:account service:from];
    if (!value.length) { ok = NO; continue; }
    if (![HDKeychain setString:value forAccount:account service:to] ||
        ![[HDKeychain stringForAccount:account service:to] isEqualToString:value]) ok = NO;
  }
  return ok;
}

+ (BOOL)copyKeychain {
  if ([HDKeychain isDisabled]) return YES;
  BOOL ok = YES;
  for (size_t i = 0; i < sizeof(kServiceSuffixes) / sizeof(kServiceSuffixes[0]); i++) {
    NSString *to = [@"com.clipspike.app." stringByAppendingString:kServiceSuffixes[i]];
    // Newest first: an item already copied from ChatClip is not overwritten by a Highlight Desk one.
    for (NSString *domain in LegacyDefaultsDomains()) {
      ok = [self copyKeychainService:[domain stringByAppendingFormat:@".%@", kServiceSuffixes[i]] to:to] && ok;
    }
  }
  return ok;
}

+ (void)runIfNeeded {
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  if ([defaults boolForKey:kDoneKey]) return;
  NSDictionary *env = NSProcessInfo.processInfo.environment;
  // Old names for the override variables still apply.
  BOOL configOverride = [env[@"CLIPSPIKE_CONFIG"] length] || [env[@"CHATCLIP_CONFIG"] length] || [env[@"HIGHLIGHT_DESK_CONFIG"] length];
  BOOL stateOverride = [env[@"CLIPSPIKE_STATE"] length] || [env[@"CHATCLIP_STATE"] length] || [env[@"HIGHLIGHT_DESK_STATE"] length];
  BOOL ok = [self copyDefaults];
  if (!configOverride) ok = [self copyConfig] && ok;
  if (!stateOverride) ok = [self moveStateDirectory] && ok;
  ok = [self copyKeychain] && ok;
  // A failed step is retried on the next launch; every step skips what is already in place.
  if (ok) [defaults setBool:YES forKey:kDoneKey];
}

@end
