#import <Foundation/Foundation.h>

// Thin wrapper over kSecClassGenericPassword items. The service name is
// supplied by the caller so credentials and license data stay separate.
// Setting CHATCLIP_KEYCHAIN=0 disables every call (tests and CI).
NS_ASSUME_NONNULL_BEGIN

@interface HDKeychain : NSObject

+ (BOOL)isDisabled;
+ (nullable NSString *)stringForAccount:(NSString *)account service:(NSString *)service;
+ (BOOL)setString:(NSString *)value forAccount:(NSString *)account service:(NSString *)service;
+ (void)deleteAccount:(NSString *)account service:(NSString *)service;

@end

NS_ASSUME_NONNULL_END
