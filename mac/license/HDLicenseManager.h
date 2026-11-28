#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, HDLicenseStanding) {
  HDLicenseStandingUnlicensed = 0,  // no key, or the key was revoked / cleared
  HDLicenseStandingValid,           // validated within the grace window
  HDLicenseStandingStale            // key present but last validation is older than the grace window
};

// Offline grace after the last successful validation (14 days).
extern const NSTimeInterval HDLicenseGraceInterval;

// Owns license persistence (Keychain), the hardware-bound instance name, and
// the offline grace policy. Network calls stay in tools/license.js.
@interface HDLicenseManager : NSObject

@property(nonatomic, readonly) HDLicenseStanding state;
@property(nonatomic, readonly, copy) NSString *licenseKey;
@property(nonatomic, readonly, copy) NSString *instanceId;
@property(nonatomic, readonly, strong) NSDate *lastValidated;

// Called on the main queue whenever `state` changes.
@property(nonatomic, copy) void (^onStateChange)(HDLicenseStanding state);

// IOPlatformUUID of this Mac, or "" when it cannot be read.
+ (NSString *)hardwareUUID;
// Name sent to Lemon Squeezy as instance_name: "<host> - <hardware UUID>".
+ (NSString *)instanceName;

// Moves a key/instance/timestamp from the legacy plaintext config into the Keychain.
- (void)migrateLegacyKey:(NSString *)key instanceId:(NSString *)instanceId lastValidated:(NSDate *)date;

- (void)recordActivationWithKey:(NSString *)key instanceId:(NSString *)instanceId;
- (void)recordValidation;
- (void)invalidateValidation;
// Deletes all three Keychain items (deactivation, refund, revocation).
- (void)clear;

- (BOOL)hasCredentials;
- (BOOL)isWithinGrace;
// Recomputes `state` from storage and notifies if it changed.
- (void)refresh;

@end
