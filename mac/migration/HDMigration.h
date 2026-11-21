#import <Foundation/Foundation.h>

// One-time, idempotent move of a pre-rename "Highlight Desk" install to ChatClip:
// preferences, ~/.highlight-desk.json, the Application Support folder, and the
// Keychain credential and license items. Nothing is deleted; Keychain items are
// copied and read back before the migration is recorded as finished.
NS_ASSUME_NONNULL_BEGIN

// Environment lookup that also honors the old HIGHLIGHT_DESK_* name of a CHATCLIP_* variable.
FOUNDATION_EXPORT NSString *_Nullable HDEnv(NSString *name);

@interface HDMigration : NSObject

+ (void)runIfNeeded;
// ~/Movies/ChatClip, or the old ~/Movies/Highlight Desk while only that exists.
+ (NSString *)defaultOutputPath;

@end

NS_ASSUME_NONNULL_END
