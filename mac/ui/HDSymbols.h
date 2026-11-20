#import <Cocoa/Cocoa.h>

typedef NS_ENUM(NSInteger, HDSymbolRole) {
  HDSymbolRoleCapture = 0,
  HDSymbolRoleClips,
  HDSymbolRoleStorage,
  HDSymbolRoleLicense,
  HDSymbolRoleSettings,

  HDSymbolRoleChannel,
  HDSymbolRoleRecord,
  HDSymbolRoleStop,
  HDSymbolRoleSave,
  HDSymbolRoleOpenClip,
  HDSymbolRoleArrowRight,
  HDSymbolRoleFolder,
  HDSymbolRoleRecent,
  HDSymbolRoleEmptyClips,
  HDSymbolRoleSpike,
  HDSymbolRoleCrop,

  HDSymbolRoleMetricClips,
  HDSymbolRoleMetricQueue,
  HDSymbolRoleMetricStorage,
  HDSymbolRoleMetricTrial,

  HDSymbolRoleStatusReady,
  HDSymbolRoleStatusLive,
  HDSymbolRoleStatusReconnecting,
  HDSymbolRoleStatusStopping,
  HDSymbolRoleStatusError,

  HDSymbolRoleFilter,
  HDSymbolRoleRefresh,
  HDSymbolRoleStateFolder,
  HDSymbolRoleOpenSelected,

  HDSymbolRoleProviderLocal,
  HDSymbolRoleProviderDropbox,
  HDSymbolRoleProviderGoogle,
  HDSymbolRoleProviderUnknown,

  HDSymbolRoleTableUploaded,
  HDSymbolRoleTableQueued,
  HDSymbolRoleTableUploading,
  HDSymbolRoleTableFailed,
  HDSymbolRoleTableUnknown,

  HDSymbolRoleStorageLocal,
  HDSymbolRoleStorageDropbox,
  HDSymbolRoleStorageGoogle,
  HDSymbolRoleStorageSelected,
  HDSymbolRoleConnect,
  HDSymbolRoleDisconnect,
  HDSymbolRoleSaveChanges,

  HDSymbolRoleLicenseTrial,
  HDSymbolRoleLicenseValid,
  HDSymbolRoleLicenseExpired,
  HDSymbolRoleLicenseDisabled,
  HDSymbolRoleActivate,
  HDSymbolRoleCheck,
  HDSymbolRoleDeactivate,
  HDSymbolRoleBuy,

  HDSymbolRoleSettingsLogin,
  HDSymbolRoleSettingsNotifications,
  HDSymbolRoleSettingsUpdates,
  HDSymbolRoleSettingsDiagnostics,
  HDSymbolRoleSettingsConfig,
  HDSymbolRoleSettingsState,
  HDSymbolRoleSettingsWeb,

  HDSymbolRoleOnboardingWelcome,
  HDSymbolRolePermission,
  HDSymbolRoleStep1,
  HDSymbolRoleStep2,
  HDSymbolRoleStep3,
  HDSymbolRoleChooseStorage,
  HDSymbolRoleOnboardingLicense,
  HDSymbolRoleStartCapture,
  HDSymbolRoleLater
};

NSString *HDSymbolName(HDSymbolRole role);
NSString *HDSymbolSelectedName(HDSymbolRole role);
NSImage *HDSymbolImage(HDSymbolRole role, CGFloat pointSize, NSFontWeight weight, NSString *accessibility);
NSImage *HDSymbolSelectedImage(HDSymbolRole role, CGFloat pointSize, NSFontWeight weight, NSString *accessibility);
NSImageView *HDSymbolImageView(HDSymbolRole role, CGFloat pointSize, NSColor *color, NSString *accessibility);
NSAttributedString *HDSymbolAttributedString(HDSymbolRole role, CGFloat pointSize, NSColor *color, NSString *text);

HDSymbolRole HDSymbolRoleForStatus(NSString *status);
HDSymbolRole HDSymbolRoleForProvider(NSString *provider);
NSColor *HDSymbolColorForStatus(NSString *status);
