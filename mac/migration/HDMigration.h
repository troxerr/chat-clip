#import <Foundation/Foundation.h>

// One-time, idempotent move of a pre-rename "ChatClip" or "Highlight Desk" install to ClipSpike:
// preferences, ~/.highlight-desk.json, the Application Support folder, and the
// Keychain credential and license items. Nothing is deleted; Keychain items are
// copied and read back before the migration is recorded as finished.
NS_ASSUME_NONNULL_BEGIN

// Environment lookup that also honors the old CHATCLIP_* and HIGHLIGHT_DESK_* names of a CLIPSPIKE_* variable.
FOUNDATION_EXPORT NSString *_Nullable HDEnv(NSString *name);

@interface HDMigration : NSObject

+ (void)runIfNeeded;
// ~/Movies/ClipSpike, or the old ~/Movies/ChatClip or ~/Movies/Highlight Desk while only that exists.
+ (NSString *)defaultOutputPath;

@end

NS_ASSUME_NONNULL_END
