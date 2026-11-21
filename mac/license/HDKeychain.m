#import "HDKeychain.h"
#import <Security/Security.h>
#import "../migration/HDMigration.h"

@implementation HDKeychain

+ (BOOL)isDisabled {
  return [HDEnv(@"CHATCLIP_KEYCHAIN") isEqualToString:@"0"];
}

+ (NSDictionary *)queryForAccount:(NSString *)account service:(NSString *)service {
  return @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: service,
    (__bridge id)kSecAttrAccount: account
  };
}

+ (NSString *)stringForAccount:(NSString *)account service:(NSString *)service {
  if ([self isDisabled] || !account.length || !service.length) return nil;
  NSMutableDictionary *query = [[self queryForAccount:account service:service] mutableCopy];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status != errSecSuccess || !result) return nil;
  NSData *data = (__bridge_transfer NSData *)result;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

+ (BOOL)setString:(NSString *)value forAccount:(NSString *)account service:(NSString *)service {
  if ([self isDisabled] || !account.length || !value.length || !service.length) return NO;
  NSDictionary *query = [self queryForAccount:account service:service];
  NSDictionary *attributes = @{
    (__bridge id)kSecValueData: [value dataUsingEncoding:NSUTF8StringEncoding],
    (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
  };
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
  if (status == errSecItemNotFound) {
    NSMutableDictionary *add = [query mutableCopy];
    [add addEntriesFromDictionary:attributes];
    status = SecItemAdd((__bridge CFDictionaryRef)add, NULL);
  }
  return status == errSecSuccess;
}

+ (void)deleteAccount:(NSString *)account service:(NSString *)service {
  if ([self isDisabled] || !account.length || !service.length) return;
  SecItemDelete((__bridge CFDictionaryRef)[self queryForAccount:account service:service]);
}

@end
