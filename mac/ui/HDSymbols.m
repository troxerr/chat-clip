#import "HDSymbols.h"

NSString *HDSymbolName(HDSymbolRole role) {
  switch (role) {
    case HDSymbolRoleCapture: return @"record.circle";
    case HDSymbolRoleClips: return @"film.stack";
    case HDSymbolRoleStorage: return @"externaldrive";
    case HDSymbolRoleLicense: return @"key";
    case HDSymbolRoleSettings: return @"gearshape";

    case HDSymbolRoleChannel: return @"bubble.left.and.bubble.right";
    case HDSymbolRoleRecord: return @"record.circle.fill";
    case HDSymbolRoleStop: return @"stop.circle.fill";
    case HDSymbolRoleSave: return @"bookmark";
    case HDSymbolRoleOpenClip: return @"play.rectangle";
    case HDSymbolRoleArrowRight: return @"arrow.right";
    case HDSymbolRoleFolder: return @"folder";
    case HDSymbolRoleRecent: return @"clock.arrow.circlepath";
    case HDSymbolRoleEmptyClips: return @"film.stack";
    case HDSymbolRoleSpike: return @"waveform.path.ecg";
    case HDSymbolRoleCrop: return @"crop";

    case HDSymbolRoleMetricClips: return @"film.stack";
    case HDSymbolRoleMetricQueue: return @"arrow.up.circle";
    case HDSymbolRoleMetricStorage: return @"externaldrive";
    case HDSymbolRoleMetricTrial: return @"clock";

    case HDSymbolRoleStatusReady: return @"checkmark.circle.fill";
    case HDSymbolRoleStatusLive: return @"dot.radiowaves.left.and.right";
    case HDSymbolRoleStatusReconnecting: return @"arrow.triangle.2.circlepath";
    case HDSymbolRoleStatusStopping: return @"stop.circle.fill";
    case HDSymbolRoleStatusError: return @"exclamationmark.triangle.fill";

    case HDSymbolRoleFilter: return @"line.3.horizontal.decrease.circle";
    case HDSymbolRoleRefresh: return @"arrow.clockwise";
    case HDSymbolRoleStateFolder: return @"folder";
    case HDSymbolRoleOpenSelected: return @"play.rectangle";

    case HDSymbolRoleProviderLocal: return @"internaldrive";
    case HDSymbolRoleProviderDropbox: return @"shippingbox";
    case HDSymbolRoleProviderGoogle: return @"triangle";
    case HDSymbolRoleProviderUnknown: return @"questionmark.circle";

    case HDSymbolRoleTableUploaded: return @"checkmark.circle.fill";
    case HDSymbolRoleTableQueued: return @"clock";
    case HDSymbolRoleTableUploading: return @"arrow.up.circle";
    case HDSymbolRoleTableFailed: return @"exclamationmark.triangle.fill";
    case HDSymbolRoleTableUnknown: return @"questionmark.circle";

    case HDSymbolRoleStorageLocal: return @"internaldrive";
    case HDSymbolRoleStorageDropbox: return @"shippingbox";
    case HDSymbolRoleStorageGoogle: return @"triangle";
    case HDSymbolRoleStorageSelected: return @"checkmark.circle.fill";
    case HDSymbolRoleConnect: return @"link";
    case HDSymbolRoleDisconnect: return @"xmark.circle";
    case HDSymbolRoleSaveChanges: return @"checkmark.circle";

    case HDSymbolRoleLicenseTrial: return @"clock";
    case HDSymbolRoleLicenseValid: return @"checkmark.seal.fill";
    case HDSymbolRoleLicenseExpired: return @"exclamationmark.triangle.fill";
    case HDSymbolRoleLicenseDisabled: return @"info.circle";
    case HDSymbolRoleActivate: return @"key.fill";
    case HDSymbolRoleCheck: return @"checkmark.circle";
    case HDSymbolRoleDeactivate: return @"xmark.circle";
    case HDSymbolRoleBuy: return @"cart.fill";

    case HDSymbolRoleSettingsLogin: return @"power";
    case HDSymbolRoleSettingsNotifications: return @"bell";
    case HDSymbolRoleSettingsUpdates: return @"arrow.triangle.2.circlepath";
    case HDSymbolRoleSettingsDiagnostics: return @"stethoscope";
    case HDSymbolRoleSettingsConfig: return @"doc.text";
    case HDSymbolRoleSettingsState: return @"folder";
    case HDSymbolRoleSettingsWeb: return @"safari";

    case HDSymbolRoleOnboardingWelcome: return @"waveform";
    case HDSymbolRolePermission: return @"checkmark.shield";
    case HDSymbolRoleStep1: return @"1.circle.fill";
    case HDSymbolRoleStep2: return @"2.circle.fill";
    case HDSymbolRoleStep3: return @"3.circle.fill";
    case HDSymbolRoleChooseStorage: return @"externaldrive";
    case HDSymbolRoleOnboardingLicense: return @"key";
    case HDSymbolRoleStartCapture: return @"record.circle.fill";
    case HDSymbolRoleLater: return @"chevron.right";
  }
  return nil;
}

NSString *HDSymbolSelectedName(HDSymbolRole role) {
  switch (role) {
    case HDSymbolRoleCapture: return @"record.circle.fill";
    case HDSymbolRoleClips: return @"film.stack.fill";
    case HDSymbolRoleStorage: return @"externaldrive.fill";
    case HDSymbolRoleLicense: return @"key.fill";
    case HDSymbolRoleSettings: return @"gearshape.fill";
    default: return HDSymbolName(role);
  }
}

NSImage *HDSymbolImage(HDSymbolRole role, CGFloat pointSize, NSFontWeight weight, NSString *accessibility) {
  NSString *name = HDSymbolName(role);
  if (!name.length) return nil;
  NSImage *image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:accessibility];
  if (!image) {
    NSLog(@"ClipSpike: missing SF Symbol %@", name);
    return nil;
  }
  NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:pointSize weight:weight];
  image = [image imageWithSymbolConfiguration:config];
  image.template = YES;
  return image;
}

NSImage *HDSymbolSelectedImage(HDSymbolRole role, CGFloat pointSize, NSFontWeight weight, NSString *accessibility) {
  NSString *name = HDSymbolSelectedName(role);
  if (!name.length) return nil;
  NSImage *image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:accessibility];
  if (!image) {
    NSLog(@"ClipSpike: missing SF Symbol %@", name);
    return nil;
  }
  NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:pointSize weight:weight];
  image = [image imageWithSymbolConfiguration:config];
  image.template = YES;
  return image;
}

NSImageView *HDSymbolImageView(HDSymbolRole role, CGFloat pointSize, NSColor *color, NSString *accessibility) {
  NSImageView *view = [[NSImageView alloc] initWithFrame:NSZeroRect];
  view.image = HDSymbolImage(role, pointSize, NSFontWeightSemibold, accessibility);
  view.imageScaling = NSImageScaleProportionallyDown;
  view.contentTintColor = color ?: NSColor.secondaryLabelColor;
  view.translatesAutoresizingMaskIntoConstraints = NO;
  [view.widthAnchor constraintEqualToConstant:pointSize + 3].active = YES;
  [view.heightAnchor constraintEqualToConstant:pointSize + 3].active = YES;
  view.accessibilityLabel = accessibility ?: @"";
  return view;
}

NSAttributedString *HDSymbolAttributedString(HDSymbolRole role, CGFloat pointSize, NSColor *color, NSString *text) {
  NSImage *symbol = HDSymbolImage(role, pointSize, NSFontWeightSemibold, text);
  if (!symbol) return [[NSAttributedString alloc] initWithString:text ?: @""];
  CGFloat side = pointSize + 3;
  NSImage *tinted = [NSImage imageWithSize:NSMakeSize(side, side) flipped:NO drawingHandler:^BOOL(NSRect rect) {
    [symbol drawInRect:rect fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
    [color set];
    NSRectFillUsingOperation(rect, NSCompositingOperationSourceAtop);
    return YES;
  }];
  NSTextAttachment *attachment = [[NSTextAttachment alloc] init];
  attachment.image = tinted;
  attachment.bounds = NSMakeRect(0, -2, side, side);
  NSMutableAttributedString *result = [[NSMutableAttributedString alloc] initWithAttributedString:[NSAttributedString attributedStringWithAttachment:attachment]];
  NSMutableParagraphStyle *style = [[NSMutableParagraphStyle alloc] init];
  style.lineBreakMode = NSLineBreakByTruncatingMiddle;
  [result appendAttributedString:[[NSAttributedString alloc] initWithString:@"  " attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:11], NSParagraphStyleAttributeName: style}]];
  [result appendAttributedString:[[NSAttributedString alloc] initWithString:text ?: @"" attributes:@{
    NSFontAttributeName: [NSFont systemFontOfSize:11],
    NSForegroundColorAttributeName: NSColor.labelColor,
    NSParagraphStyleAttributeName: style
  }]];
  return result;
}

HDSymbolRole HDSymbolRoleForStatus(NSString *status) {
  NSString *value = [status ?: @"" lowercaseString];
  if ([value isEqualToString:@"uploaded"] || [value isEqualToString:@"local"]) return HDSymbolRoleTableUploaded;
  if ([value isEqualToString:@"queued"] || [value isEqualToString:@"pending"]) return HDSymbolRoleTableQueued;
  if ([value isEqualToString:@"uploading"]) return HDSymbolRoleTableUploading;
  if ([value containsString:@"failed"] || [value containsString:@"error"]) return HDSymbolRoleTableFailed;
  return HDSymbolRoleTableUnknown;
}

HDSymbolRole HDSymbolRoleForProvider(NSString *provider) {
  NSString *value = provider ?: @"";
  if ([value isEqualToString:@"local"]) return HDSymbolRoleProviderLocal;
  if ([value isEqualToString:@"dropbox"]) return HDSymbolRoleProviderDropbox;
  if ([value isEqualToString:@"googleDrive"]) return HDSymbolRoleProviderGoogle;
  return HDSymbolRoleProviderUnknown;
}

static NSColor *HDStatusHex(NSString *hex) {
  unsigned int v = 0;
  NSScanner *scanner = [NSScanner scannerWithString:[hex stringByReplacingOccurrencesOfString:@"#" withString:@""]];
  [scanner scanHexInt:&v];
  return [NSColor colorWithSRGBRed:((v >> 16) & 0xff) / 255.0 green:((v >> 8) & 0xff) / 255.0 blue:(v & 0xff) / 255.0 alpha:1];
}

NSColor *HDSymbolColorForStatus(NSString *status) {
  HDSymbolRole role = HDSymbolRoleForStatus(status);
  if (role == HDSymbolRoleTableUploaded) return HDStatusHex(@"#10B981");
  if (role == HDSymbolRoleTableQueued || role == HDSymbolRoleTableUploading) return HDStatusHex(@"#F59E0B");
  if (role == HDSymbolRoleTableFailed) return HDStatusHex(@"#F59E0B");
  return [NSColor colorWithSRGBRed:0xA1 / 255.0 green:0xA1 / 255.0 blue:0xAA / 255.0 alpha:1];
}
