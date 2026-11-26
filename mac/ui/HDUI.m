#import "HDUI.h"
#import "HDSymbols.h"
#import "../migration/HDMigration.h"
#import <QuartzCore/QuartzCore.h>
#import <AVKit/AVKit.h>
#import <AVFoundation/AVFoundation.h>

static NSColor *HDHex(NSString *hex) {
  unsigned int v = 0;
  NSScanner *scanner = [NSScanner scannerWithString:[hex stringByReplacingOccurrencesOfString:@"#" withString:@""]];
  [scanner scanHexInt:&v];
  return [NSColor colorWithSRGBRed:((v >> 16) & 0xff) / 255.0
                             green:((v >> 8) & 0xff) / 255.0
                              blue:(v & 0xff) / 255.0
                             alpha:1];
}

static BOOL HDDark(NSAppearance *appearance) {
  return [[appearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameDarkAqua, NSAppearanceNameAqua]] isEqualToString:NSAppearanceNameDarkAqua];
}

// Brand tokens: deep violet for actions, soft lavender for selection.
// Content stays neutral so previews and live/error indicators keep their meaning.
static NSColor *HDAccent(void) { return HDHex(@"#7042C1"); }
static NSColor *HDAccentText(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#CCB5FF") : HDHex(@"#6236AD");
  }];
}
static NSColor *HDSelection(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#332448") : HDHex(@"#EEE6FA");
  }];
}

static NSColor *HDInk(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#151318") : HDHex(@"#F7F6FA");
  }];
}

static NSColor *HDSurface(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#201D25") : HDHex(@"#FFFFFF");
  }];
}

static NSColor *HDHairline(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#39333F") : HDHex(@"#E4DFEA");
  }];
}

static NSColor *HDText(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#F4F4F5") : HDHex(@"#111113");
  }];
}

static NSColor *HDMuted(void) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return HDDark(appearance) ? HDHex(@"#B6AFBF") : HDHex(@"#696172");
  }];
}

// Snapshot dynamic colors under the owning view's appearance before AppKit tints icons.
static NSColor *HDResolved(NSColor *color, NSAppearance *appearance) {
  __block NSColor *resolved;
  [appearance performAsCurrentDrawingAppearance:^{ resolved = [NSColor colorWithCGColor:color.CGColor]; }];
  return resolved;
}

static NSColor *HDSpikeViolet(NSAppearance *appearance) {
  return HDDark(appearance) ? HDHex(@"#9A74E8") : HDHex(@"#7042C1");
}

static NSColor *HDGood(void) { return HDHex(@"#10B981"); }
static NSColor *HDWarn(void) { return HDHex(@"#F59E0B"); }
static NSColor *HDLive(void) { return HDHex(@"#EF4444"); }

static NSFont *HDMono(CGFloat size) {
  NSFont *font = [NSFont fontWithName:@"JetBrainsMono-Regular" size:size];
  if (!font) font = [NSFont fontWithName:@"GeistMono-Regular" size:size];
  if (!font) font = [NSFont monospacedSystemFontOfSize:size weight:NSFontWeightRegular];
  return font;
}

static NSFont *HDTabular(CGFloat size) {
  NSFont *mono = [NSFont fontWithName:@"JetBrainsMono-Regular" size:size];
  if (mono) return mono;
  return [NSFont monospacedDigitSystemFontOfSize:size weight:NSFontWeightRegular];
}

static NSTextField *HDLabel(NSString *text, CGFloat size, NSFontWeight weight, NSColor *color) {
  NSTextField *field = [NSTextField labelWithString:text ?: @""];
  field.font = [NSFont systemFontOfSize:size weight:weight];
  field.textColor = color ?: NSColor.labelColor;
  field.maximumNumberOfLines = 0;
  field.lineBreakMode = NSLineBreakByWordWrapping;
  return field;
}

static NSTextField *HDCaption(NSString *text) {
  return HDLabel(text, 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
}

@interface HDPrimaryButton : NSButton
- (void)refreshColors;
@end
@implementation HDPrimaryButton {
  BOOL _hover;
  NSTrackingArea *_tracking;
}
- (NSSize)intrinsicContentSize {
  NSSize size = [super intrinsicContentSize];
  size.width += 24; // Custom drawing needs the native control's horizontal breathing room.
  return size;
}
- (void)refreshColors {
  self.wantsLayer = YES;
  self.layer.cornerRadius = 7;
  self.contentTintColor = NSColor.whiteColor;
  self.needsDisplay = YES;
}
- (void)drawRect:(NSRect)dirtyRect {
  BOOL dark = HDDark(self.effectiveAppearance);
  NSColor *fill = HDAccent();
  if (!self.enabled) fill = [HDAccent() colorWithAlphaComponent:dark ? 0.32 : 0.38];
  else if (self.highlighted) fill = [fill blendedColorWithFraction:0.22 ofColor:NSColor.blackColor];
  else if (_hover) fill = dark ? [fill blendedColorWithFraction:0.16 ofColor:NSColor.whiteColor] : [fill blendedColorWithFraction:0.12 ofColor:NSColor.blackColor];
  [fill setFill];
  [[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 0, 1) xRadius:7 yRadius:7] fill];
  NSDictionary *attributes = @{NSFontAttributeName:self.font, NSForegroundColorAttributeName:self.enabled ? NSColor.whiteColor : [NSColor colorWithWhite:1 alpha:0.7]};
  NSSize size = [self.title sizeWithAttributes:attributes];
  CGFloat iconSize = self.image ? 13 : 0;
  CGFloat gap = self.image ? 7 : 0;
  CGFloat left = round((self.bounds.size.width - size.width - iconSize - gap) / 2);
  if (self.image) {
    NSImage *source = self.image;
    NSImage *icon = [NSImage imageWithSize:NSMakeSize(iconSize, iconSize) flipped:NO drawingHandler:^BOOL(NSRect rect) {
      [source drawInRect:rect];
      [(self.enabled ? NSColor.whiteColor : [NSColor colorWithWhite:1 alpha:0.7]) setFill];
      NSRectFillUsingOperation(rect, NSCompositingOperationSourceIn);
      return YES;
    }];
    [icon drawInRect:NSMakeRect(left, round((self.bounds.size.height-iconSize)/2), iconSize, iconSize)];
  }
  [self.title drawAtPoint:NSMakePoint(left + iconSize + gap, round((self.bounds.size.height-size.height)/2)) withAttributes:attributes];
  if (self.window.firstResponder == self && NSApp.isActive) {
    [(dark ? HDHex(@"#CCB5FF") : HDHex(@"#4B2C8A")) setStroke];
    NSBezierPath *focus = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 1, 2) xRadius:6 yRadius:6];
    focus.lineWidth = 2; [focus stroke];
  }
}
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc] initWithRect:self.bounds options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
  [self addTrackingArea:_tracking];
}
- (void)mouseEntered:(NSEvent *)event { _hover = YES; [self refreshColors]; }
- (void)mouseExited:(NSEvent *)event { _hover = NO; [self refreshColors]; }
- (void)setEnabled:(BOOL)enabled { [super setEnabled:enabled]; [self refreshColors]; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshColors]; }
@end

static NSButton *HDButtonWithSymbol(NSString *title, id target, SEL action, BOOL primary, HDSymbolRole role) {
  NSButton *button = primary ? [HDPrimaryButton buttonWithTitle:title target:target action:action] : [NSButton buttonWithTitle:title target:target action:action];
  button.controlSize = NSControlSizeRegular;
  button.font = [NSFont systemFontOfSize:12.5 weight:NSFontWeightMedium];
  [button.heightAnchor constraintEqualToConstant:32].active = YES;
  if (role != NSNotFound) {
    button.image = HDSymbolImage(role, 12, NSFontWeightMedium, title);
    button.imagePosition = NSImageLeading;
    button.imageHugsTitle = YES;
  }
  if (primary) {
    button.bezelStyle = NSBezelStyleRounded;
    button.bordered = NO;
    button.wantsLayer = YES;
    [(HDPrimaryButton *)button refreshColors];
    button.layer.cornerRadius = 7;
  } else {
    button.bezelStyle = NSBezelStyleRounded;
    button.bordered = YES;
    button.contentTintColor = NSColor.secondaryLabelColor;
  }
  return button;
}

static NSButton *HDButton(NSString *title, id target, SEL action, BOOL primary) {
  return HDButtonWithSymbol(title, target, action, primary, NSNotFound);
}

@interface HDCanvasView : NSView
@end
@implementation HDCanvasView
- (BOOL)wantsUpdateLayer { return YES; }
- (void)updateLayer {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.layer.backgroundColor = HDInk().CGColor;
  }];
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay = YES; }
@end

@interface HDRuleView : NSView
@end
@implementation HDRuleView
- (BOOL)wantsUpdateLayer { return YES; }
- (void)updateLayer {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.layer.backgroundColor = HDHairline().CGColor;
  }];
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay = YES; }
@end

@interface HDEventLabel : NSTextField
@end
@implementation HDEventLabel
- (void)setStringValue:(NSString *)value { [super setStringValue:value ?: @""]; self.hidden = !value.length; }
@end

@interface HDDocumentView : NSView
@end
@implementation HDDocumentView
- (BOOL)isFlipped { return YES; }
@end

@interface HDCardView : NSView
@property BOOL destinationSelected;
@end

@implementation HDCardView {
  NSTrackingArea *_tracking;
}
- (instancetype)initWithFrame:(NSRect)frameRect {
  self = [super initWithFrame:frameRect];
  if (self) {
    self.wantsLayer = YES;
    self.layer.cornerRadius = 10;
    self.layer.borderWidth = 1;
    [self updateLayerColors];
  }
  return self;
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self updateLayerColors];
}
- (void)updateLayerColors {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.layer.backgroundColor = (self.destinationSelected ? HDSelection() : HDSurface()).CGColor;
    self.layer.borderColor = (self.destinationSelected ? HDAccentText() : HDHairline()).CGColor;
    self.layer.borderWidth = self.destinationSelected ? 2 : 1;
  }];
}
@end

@interface HDNavButton : NSButton
@end

@implementation HDNavButton {
  BOOL _selected;
  HDSymbolRole _role;
}
- (instancetype)initWithTitle:(NSString *)title role:(HDSymbolRole)role target:(id)target action:(SEL)action {
  self = [super initWithFrame:NSZeroRect];
  if (self) {
    _role = role;
    self.title = title;
    self.image = HDSymbolImage(role, 13, NSFontWeightMedium, title);
    self.imagePosition = NSImageLeading;
    self.imageScaling = NSImageScaleProportionallyDown;
    self.alignment = NSTextAlignmentLeft;
    self.bordered = NO;
    self.bezelStyle = NSBezelStyleInline;
    self.font = [NSFont systemFontOfSize:12.5 weight:NSFontWeightMedium];
    self.contentTintColor = NSColor.secondaryLabelColor;
    self.target = target;
    self.action = action;
    self.wantsLayer = YES;
    self.layer.cornerRadius = 7;
    [self.heightAnchor constraintEqualToConstant:36].active = YES;
  }
  return self;
}
- (void)setSelectedAppearance:(BOOL)selected {
  _selected = selected;
  self.layer.backgroundColor = NSColor.clearColor.CGColor;
  self.contentTintColor = HDResolved(selected ? HDAccentText() : HDMuted(), self.effectiveAppearance);
  self.needsDisplay = YES;
  self.font = [NSFont systemFontOfSize:12.5 weight:selected ? NSFontWeightSemibold : NSFontWeightMedium];
  self.image = selected ? HDSymbolSelectedImage(_role, 13, NSFontWeightSemibold, self.title)
                        : HDSymbolImage(_role, 13, NSFontWeightMedium, self.title);
}
- (void)drawRect:(NSRect)dirtyRect {
  if (_selected) {
    [HDSelection() setFill];
    [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:7 yRadius:7] fill];
    [HDSpikeViolet(self.effectiveAppearance) setFill];
    [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(0, round(NSHeight(self.bounds) / 2) - 8, 3, 16) xRadius:1.5 yRadius:1.5] fill];
  }
  [super drawRect:dirtyRect];
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self setSelectedAppearance:_selected];
}
@end

// MARK: - Studio views

static void HDStyleSegmented(NSSegmentedControl *control) {
  control.selectedSegmentBezelColor = HDAccent();
}

// Draws a capsule with centered text and returns its width.
static CGFloat HDDrawPill(NSString *text, NSPoint origin, NSFont *font, NSColor *fill, NSColor *ink, NSColor *dot) {
  NSDictionary *attributes = @{NSFontAttributeName:font, NSForegroundColorAttributeName:ink};
  NSSize size = [text sizeWithAttributes:attributes];
  CGFloat dotSpace = dot ? 11 : 0;
  CGFloat width = ceil(size.width) + 14 + dotSpace;
  CGFloat height = ceil(size.height) + 4;
  NSRect rect = NSMakeRect(origin.x, origin.y, width, height);
  [fill setFill];
  [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:height / 2 yRadius:height / 2] fill];
  CGFloat textX = origin.x + 7;
  if (dot) {
    [dot setFill];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(textX, origin.y + (height - 6) / 2, 6, 6)] fill];
    textX += dotSpace;
  }
  [text drawAtPoint:NSMakePoint(textX, origin.y + 2) withAttributes:attributes];
  return width;
}

static const NSUInteger kHDPulseMaxBars = 72;
static const NSTimeInterval kHDPulseTriggerLife = 25;

@implementation HDChatPulseView {
  NSMutableArray<NSDictionary *> *_samples;
  NSDictionary *_trigger;
  NSDate *_triggerAt;
  NSDate *_lastAt;
}
- (instancetype)initWithFrame:(NSRect)frameRect {
  self = [super initWithFrame:frameRect];
  if (self) {
    _samples = [NSMutableArray array];
    self.translatesAutoresizingMaskIntoConstraints = NO;
    self.accessibilityElement = YES;
    self.accessibilityRole = NSAccessibilityImageRole;
    self.accessibilityLabel = @"Live chat pulse";
    self.accessibilityValue = @"Waiting for chat activity";
    [self.heightAnchor constraintEqualToConstant:88].active = YES;
  }
  return self;
}
- (void)reset {
  [_samples removeAllObjects];
  _trigger = nil; _triggerAt = nil; _lastAt = nil;
  self.accessibilityValue = @"Waiting for chat activity";
  self.needsDisplay = YES;
}
- (void)addSample:(NSDictionary *)sample {
  NSDate *now = [sample[@"at"] isKindOfClass:NSDate.class] ? sample[@"at"] : [NSDate date];
  NSMutableDictionary *entry = [sample mutableCopy];
  entry[@"at"] = now;
  // Status events arrive once per sampling window; coalesce anything faster than 1s.
  if (_samples.count && _lastAt && [now timeIntervalSinceDate:_lastAt] < 1.0) [_samples removeLastObject];
  [_samples addObject:entry];
  _lastAt = now;
  while (_samples.count > kHDPulseMaxBars) [_samples removeObjectAtIndex:0];
  if ([entry[@"trigger"] boolValue]) {
    [self noteTrigger:@{@"participants": entry[@"participants"] ?: @0, @"topEmotes": entry[@"topEmotes"] ?: @[]}];
  }
  self.accessibilityValue = [NSString stringWithFormat:@"%ld chatters, threshold %.0f%@", (long)[entry[@"participants"] integerValue], [entry[@"threshold"] doubleValue], [entry[@"trigger"] boolValue] ? @", spike detected" : @""];
  self.needsDisplay = YES;
}
- (void)noteTrigger:(NSDictionary *)info {
  NSArray *emotes = [info[@"topEmotes"] isKindOfClass:NSArray.class] ? info[@"topEmotes"] : @[];
  NSNumber *participants = [info[@"participants"] isKindOfClass:NSNumber.class] ? info[@"participants"] : nil;
  BOOL fresh = _triggerAt && [[NSDate date] timeIntervalSinceDate:_triggerAt] < 10;
  _trigger = @{
    @"participants": participants ?: (fresh ? _trigger[@"participants"] : nil) ?: @0,
    @"emotes": emotes.count ? emotes : (fresh ? _trigger[@"emotes"] : nil) ?: @[]
  };
  _triggerAt = [NSDate date];
  self.needsDisplay = YES;
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay = YES; }
- (void)drawRect:(NSRect)dirtyRect {
  NSAppearance *appearance = self.effectiveAppearance;
  NSRect bounds = self.bounds;
  [HDInk() setFill];
  [[NSBezierPath bezierPathWithRoundedRect:bounds xRadius:8 yRadius:8] fill];
  [HDHairline() setStroke];
  NSBezierPath *frame = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(bounds, 0.5, 0.5) xRadius:8 yRadius:8];
  frame.lineWidth = 1; [frame stroke];

  NSFont *caption = [NSFont systemFontOfSize:10.5 weight:NSFontWeightSemibold];
  NSFont *numbers = [NSFont monospacedDigitSystemFontOfSize:10.5 weight:NSFontWeightRegular];
  CGFloat headerY = NSMaxY(bounds) - 19;
  NSString *title = @"CHAT PULSE";
  NSDictionary *titleAttributes = @{NSFontAttributeName:caption, NSForegroundColorAttributeName:HDMuted(), NSKernAttributeName:@0.6};
  [title drawAtPoint:NSMakePoint(10, headerY) withAttributes:titleAttributes];
  CGFloat titleRight = 10 + [title sizeWithAttributes:titleAttributes].width;

  NSDictionary *latest = _samples.lastObject;
  double threshold = [latest[@"threshold"] doubleValue];
  double median = [latest[@"median"] doubleValue];
  CGFloat rightEdge = NSMaxX(bounds) - 10;
  if (latest) {
    NSString *summary = [NSString stringWithFormat:@"%ld chatters · median %.0f · threshold %.0f", (long)[latest[@"participants"] integerValue], median, threshold];
    NSDictionary *attributes = @{NSFontAttributeName:numbers, NSForegroundColorAttributeName:HDMuted()};
    CGFloat width = [summary sizeWithAttributes:attributes].width;
    rightEdge = NSMaxX(bounds) - 10 - width;
    [summary drawAtPoint:NSMakePoint(rightEdge, headerY) withAttributes:attributes];
  }

  // Compact trigger pills: what chat did when the clip fired.
  if (_trigger && _triggerAt && [[NSDate date] timeIntervalSinceDate:_triggerAt] < kHDPulseTriggerLife) {
    NSFont *pillFont = [NSFont systemFontOfSize:10 weight:NSFontWeightSemibold];
    CGFloat x = titleRight + 12;
    CGFloat y = headerY - 2;
    NSString *chatters = [NSString stringWithFormat:@"Clip · %ld chatters", (long)[_trigger[@"participants"] integerValue]];
    CGFloat w = HDDrawPill(chatters, NSMakePoint(x, y), pillFont, HDSelection(), HDAccentText(), HDLive());
    x += w + 5;
    NSUInteger shown = 0;
    for (NSDictionary *emote in _trigger[@"emotes"]) {
      if (![emote isKindOfClass:NSDictionary.class] || shown >= 2) break;
      NSString *text = [NSString stringWithFormat:@"%@ ×%ld", emote[@"name"] ?: @"emote", (long)[emote[@"count"] integerValue]];
      CGFloat estimate = [text sizeWithAttributes:@{NSFontAttributeName:pillFont}].width + 18;
      if (x + estimate > rightEdge - 10) break;
      w = HDDrawPill(text, NSMakePoint(x, y), pillFont, HDSelection(), HDAccentText(), nil);
      x += w + 5; shown++;
    }
  }

  NSRect plot = NSMakeRect(10, 9, NSWidth(bounds) - 20, NSHeight(bounds) - 34);
  [NSGraphicsContext saveGraphicsState];
  [NSBezierPath clipRect:NSInsetRect(plot, -2, -2)];
  if (!_samples.count) {
    [HDHairline() setStroke];
    NSBezierPath *base = [NSBezierPath bezierPath];
    [base moveToPoint:NSMakePoint(NSMinX(plot), NSMinY(plot) + 1)]; [base lineToPoint:NSMakePoint(NSMaxX(plot), NSMinY(plot) + 1)];
    CGFloat dash[2] = {3, 3}; [base setLineDash:dash count:2 phase:0]; base.lineWidth = 1; [base stroke];
    NSString *empty = @"Waiting for chat activity…";
    NSDictionary *attributes = @{NSFontAttributeName:[NSFont systemFontOfSize:11], NSForegroundColorAttributeName:HDMuted()};
    NSSize size = [empty sizeWithAttributes:attributes];
    [empty drawAtPoint:NSMakePoint(NSMidX(plot) - size.width / 2, NSMidY(plot) - size.height / 2 + 2) withAttributes:attributes];
    [NSGraphicsContext restoreGraphicsState];
    return;
  }
  double peak = 4;
  for (NSDictionary *sample in _samples) peak = MAX(peak, [sample[@"participants"] doubleValue]);
  double yMax = MAX(peak, threshold * 1.25);
  CGFloat slot = NSWidth(plot) / kHDPulseMaxBars;
  CGFloat barWidth = MAX(2, slot - 1.5);
  NSColor *quiet = [(HDDark(appearance) ? HDHex(@"#CCB5FF") : HDAccent()) colorWithAlphaComponent:0.34];
  NSColor *spike = HDSpikeViolet(appearance);
  NSUInteger count = _samples.count;
  for (NSUInteger i = 0; i < count; i++) {
    NSDictionary *sample = _samples[i];
    double participants = [sample[@"participants"] doubleValue];
    double sampleThreshold = [sample[@"threshold"] doubleValue];
    CGFloat height = participants > 0 ? MAX(2, participants / yMax * NSHeight(plot)) : 1;
    CGFloat x = NSMaxX(plot) - (count - i) * slot + (slot - barWidth) / 2;
    BOOL fired = [sample[@"trigger"] boolValue];
    [(fired ? HDLive() : (sampleThreshold > 0 && participants >= sampleThreshold ? spike : quiet)) setFill];
    [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(x, NSMinY(plot), barWidth, height) xRadius:1.5 yRadius:1.5] fill];
  }
  if (median > 0) {
    CGFloat y = NSMinY(plot) + median / yMax * NSHeight(plot);
    [[HDMuted() colorWithAlphaComponent:0.4] setStroke];
    NSBezierPath *line = [NSBezierPath bezierPath];
    [line moveToPoint:NSMakePoint(NSMinX(plot), y)]; [line lineToPoint:NSMakePoint(NSMaxX(plot), y)];
    line.lineWidth = 0.75; [line stroke];
  }
  if (threshold > 0) {
    CGFloat y = round(NSMinY(plot) + threshold / yMax * NSHeight(plot)) + 0.5;
    [HDAccentText() setStroke];
    NSBezierPath *line = [NSBezierPath bezierPath];
    [line moveToPoint:NSMakePoint(NSMinX(plot), y)]; [line lineToPoint:NSMakePoint(NSMaxX(plot), y)];
    CGFloat dash[2] = {5, 3}; [line setLineDash:dash count:2 phase:0];
    line.lineWidth = 1.25; [line stroke];
  }
  [NSGraphicsContext restoreGraphicsState];
}
@end

static const CGFloat kHDFacecamRects[4][4] = { // x, y(from top), w, h — mirrors lib/reframe.js FACECAM_CORNERS
  {0.015, 0.02, 0.25, 0.28}, {0.735, 0.02, 0.25, 0.28}, {0.015, 0.70, 0.25, 0.28}, {0.735, 0.70, 0.25, 0.28}
};
static NSArray<NSString *> *HDCornerNames(void) { return @[@"top-left", @"top-right", @"bottom-left", @"bottom-right"]; }

static void HDDrawFakeStream(NSRect rect, NSAppearance *appearance) {
  NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:HDDark(appearance) ? HDHex(@"#2C2540") : HDHex(@"#5A4A86")
                                                       endingColor:HDDark(appearance) ? HDHex(@"#1A1626") : HDHex(@"#33284F")];
  [gradient drawInRect:rect angle:-35];
  [[NSColor colorWithWhite:1 alpha:0.06] setStroke];
  NSBezierPath *grid = [NSBezierPath bezierPath];
  for (NSInteger i = 1; i < 4; i++) {
    CGFloat x = NSMinX(rect) + NSWidth(rect) * i / 4.0;
    [grid moveToPoint:NSMakePoint(x, NSMinY(rect))]; [grid lineToPoint:NSMakePoint(x, NSMaxY(rect))];
  }
  grid.lineWidth = 0.5; [grid stroke];
}

static void HDDrawPerson(NSRect rect, NSColor *color) {
  [NSGraphicsContext saveGraphicsState];
  [NSBezierPath clipRect:rect];
  [color setFill];
  CGFloat side = MIN(NSWidth(rect), NSHeight(rect));
  CGFloat head = side * 0.34;
  [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(NSMidX(rect) - head / 2, NSMidY(rect) - head * 0.05, head, head)] fill];
  CGFloat shoulderW = side * 0.78, shoulderH = side * 0.48;
  [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(NSMidX(rect) - shoulderW / 2, NSMinY(rect) - shoulderH * 0.25, shoulderW, shoulderH) xRadius:shoulderW / 2 yRadius:shoulderH / 2] fill];
  [NSGraphicsContext restoreGraphicsState];
}

@implementation HDLayoutPreviewView {
  NSRect _sourceRect;
}
- (instancetype)initWithFrame:(NSRect)frameRect {
  self = [super initWithFrame:frameRect];
  if (self) {
    _layout = @"blur"; _camHeightRatio = 0.35; _facecamCorner = @"bottom-left";
    self.translatesAutoresizingMaskIntoConstraints = NO;
    self.accessibilityElement = YES;
    self.accessibilityRole = NSAccessibilityImageRole;
    self.accessibilityLabel = @"Vertical layout preview";
    [self refreshAccessibility];
  }
  return self;
}
- (void)refreshAccessibility {
  self.accessibilityValue = [self.layout isEqualToString:@"split"]
    ? [NSString stringWithFormat:@"Split: facecam from the %@ corner on top, %.0f percent of the height, gameplay below", [self.facecamCorner stringByReplacingOccurrencesOfString:@"-" withString:@" "], self.camHeightRatio * 100]
    : @"Blur fill: the full stream centered over a blurred copy of itself";
  self.needsDisplay = YES;
}
- (void)setLayout:(NSString *)layout { _layout = [layout isEqualToString:@"split"] ? @"split" : @"blur"; [self refreshAccessibility]; }
- (void)setCamHeightRatio:(double)ratio { _camHeightRatio = MAX(0.2, MIN(0.5, ratio)); [self refreshAccessibility]; }
- (void)setFacecamCorner:(NSString *)corner { _facecamCorner = [HDCornerNames() containsObject:corner] ? [corner copy] : @"bottom-left"; [self refreshAccessibility]; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay = YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event {
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  if (![self.layout isEqualToString:@"split"] || !NSPointInRect(point, _sourceRect)) return;
  BOOL right = (point.x - NSMinX(_sourceRect)) > NSWidth(_sourceRect) / 2;
  BOOL top = (point.y - NSMinY(_sourceRect)) > NSHeight(_sourceRect) / 2;
  NSString *corner = top ? (right ? @"top-right" : @"top-left") : (right ? @"bottom-right" : @"bottom-left");
  self.facecamCorner = corner;
  if (self.cornerPicked) self.cornerPicked(corner);
}
- (void)drawRect:(NSRect)dirtyRect {
  NSAppearance *appearance = self.effectiveAppearance;
  NSRect bounds = self.bounds;
  BOOL split = [self.layout isEqualToString:@"split"];
  NSFont *label = [NSFont systemFontOfSize:10.5 weight:NSFontWeightMedium];
  NSDictionary *labelAttributes = @{NSFontAttributeName:label, NSForegroundColorAttributeName:HDMuted()};

  CGFloat labelBand = 22;
  CGFloat outH = NSHeight(bounds) - labelBand - 4;
  CGFloat outW = round(outH * 9.0 / 16.0);
  CGFloat srcW = MIN(NSWidth(bounds) - outW - 76, 232);
  CGFloat srcH = round(srcW * 9.0 / 16.0);
  CGFloat total = srcW + 56 + outW;
  CGFloat originX = MAX(0, round((NSWidth(bounds) - total) / 2));
  _sourceRect = NSMakeRect(originX, labelBand + 4 + round((outH - srcH) / 2), srcW, srcH);
  NSRect outRect = NSMakeRect(NSMaxX(_sourceRect) + 56, labelBand + 4, outW, outH);

  // Source 16:9 frame.
  NSBezierPath *sourcePath = [NSBezierPath bezierPathWithRoundedRect:_sourceRect xRadius:6 yRadius:6];
  [NSGraphicsContext saveGraphicsState];
  [sourcePath addClip];
  HDDrawFakeStream(_sourceRect, appearance);
  if (split) {
    NSArray *names = HDCornerNames();
    NSUInteger selected = [names indexOfObject:self.facecamCorner];
    if (selected == NSNotFound) selected = 2;
    for (NSUInteger i = 0; i < 4; i++) {
      NSRect rect = NSMakeRect(NSMinX(_sourceRect) + kHDFacecamRects[i][0] * srcW,
                               NSMaxY(_sourceRect) - (kHDFacecamRects[i][1] + kHDFacecamRects[i][3]) * srcH,
                               kHDFacecamRects[i][2] * srcW, kHDFacecamRects[i][3] * srcH);
      NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:rect xRadius:4 yRadius:4];
      if (i == selected) {
        [[HDHex(@"#CCB5FF") colorWithAlphaComponent:0.28] setFill]; [path fill];
        HDDrawPerson(rect, [HDHex(@"#EEE6FA") colorWithAlphaComponent:0.9]);
        [HDHex(@"#CCB5FF") setStroke]; path.lineWidth = 2; [path stroke];
      } else {
        [[NSColor colorWithWhite:1 alpha:0.35] setStroke];
        CGFloat dash[2] = {2, 2}; [path setLineDash:dash count:2 phase:0]; path.lineWidth = 1; [path stroke];
      }
    }
  }
  [NSGraphicsContext restoreGraphicsState];
  [HDHairline() setStroke]; sourcePath.lineWidth = 1; [sourcePath stroke];

  // Arrow.
  NSBezierPath *arrow = [NSBezierPath bezierPath];
  CGFloat ax = NSMaxX(_sourceRect) + 14, ay = NSMidY(outRect);
  [arrow moveToPoint:NSMakePoint(ax, ay)]; [arrow lineToPoint:NSMakePoint(ax + 26, ay)];
  [arrow moveToPoint:NSMakePoint(ax + 20, ay + 5)]; [arrow lineToPoint:NSMakePoint(ax + 27, ay)]; [arrow lineToPoint:NSMakePoint(ax + 20, ay - 5)];
  arrow.lineWidth = 1.5; arrow.lineCapStyle = NSLineCapStyleRound; arrow.lineJoinStyle = NSLineJoinStyleRound;
  [HDAccentText() setStroke]; [arrow stroke];

  // Output 9:16 frame.
  NSBezierPath *outPath = [NSBezierPath bezierPathWithRoundedRect:outRect xRadius:8 yRadius:8];
  [NSGraphicsContext saveGraphicsState];
  [outPath addClip];
  if (split) {
    CGFloat camH = round(outH * self.camHeightRatio);
    NSRect camRect = NSMakeRect(NSMinX(outRect), NSMaxY(outRect) - camH, outW, camH);
    NSRect gameRect = NSMakeRect(NSMinX(outRect), NSMinY(outRect), outW, outH - camH);
    HDDrawFakeStream(gameRect, appearance);
    NSGradient *camGradient = [[NSGradient alloc] initWithStartingColor:HDHex(@"#7042C1") endingColor:HDHex(@"#4B2C8A")];
    [camGradient drawInRect:camRect angle:-60];
    HDDrawPerson(camRect, [HDHex(@"#EEE6FA") colorWithAlphaComponent:0.92]);
    [[NSColor colorWithWhite:1 alpha:0.5] setFill];
    NSRectFill(NSMakeRect(NSMinX(outRect), NSMinY(camRect) - 0.5, outW, 1));
    NSDictionary *tag = @{NSFontAttributeName:[NSFont systemFontOfSize:9.5 weight:NSFontWeightSemibold], NSForegroundColorAttributeName:NSColor.whiteColor};
    [[NSString stringWithFormat:@"Facecam %.0f%%", self.camHeightRatio * 100] drawAtPoint:NSMakePoint(NSMinX(outRect) + 7, NSMaxY(outRect) - 16) withAttributes:tag];
    [@"Gameplay" drawAtPoint:NSMakePoint(NSMinX(outRect) + 7, NSMinY(outRect) + 6) withAttributes:tag];
  } else {
    NSGradient *backdrop = [[NSGradient alloc] initWithStartingColor:HDDark(appearance) ? HDHex(@"#3A2F58") : HDHex(@"#7A68AD")
                                                         endingColor:HDDark(appearance) ? HDHex(@"#211A33") : HDHex(@"#4A3B74")];
    [backdrop drawInRect:outRect angle:90];
    [[NSColor colorWithWhite:0 alpha:0.28] setFill]; NSRectFill(outRect);
    CGFloat stripH = round(outW * 9.0 / 16.0);
    NSRect strip = NSMakeRect(NSMinX(outRect), NSMidY(outRect) - stripH / 2, outW, stripH);
    HDDrawFakeStream(strip, appearance);
  }
  [NSGraphicsContext restoreGraphicsState];
  [HDHairline() setStroke]; outPath.lineWidth = 1; [outPath stroke];

  NSString *left = @"Stream · 16:9", *right = split ? @"Split · 9:16" : @"Blur fill · 9:16";
  [left drawAtPoint:NSMakePoint(NSMinX(_sourceRect), 4) withAttributes:labelAttributes];
  [right drawAtPoint:NSMakePoint(NSMinX(outRect), 4) withAttributes:labelAttributes];
  if (split) {
    NSString *hint = @"Click a corner";
    NSSize hs = [hint sizeWithAttributes:labelAttributes];
    if (NSMinX(_sourceRect) + [left sizeWithAttributes:labelAttributes].width + hs.width + 16 < NSMaxX(_sourceRect))
      [hint drawAtPoint:NSMakePoint(NSMaxX(_sourceRect) - hs.width, 4) withAttributes:@{NSFontAttributeName:label, NSForegroundColorAttributeName:HDAccentText()}];
  }
}
@end

// Portrait thumbnail with status/peak badges; doubles as the card's primary Open button.
@interface HDClipThumbView : NSView
@property(strong, nonatomic) NSImage *image;
@property(copy) NSString *peakText;
@property(copy) NSString *statusText;
@property(strong) NSColor *statusColor;
@property(copy) NSString *emoteText;
@property(copy) NSString *placeholder;
@property(copy) void (^onClick)(void);
@end
@implementation HDClipThumbView
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)setImage:(NSImage *)image { _image = image; self.needsDisplay = YES; }
- (void)mouseDown:(NSEvent *)event { if (self.onClick) self.onClick(); }
- (BOOL)accessibilityPerformPress { if (self.onClick) self.onClick(); return YES; }
- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:NSCursor.pointingHandCursor]; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay = YES; }
- (void)drawRect:(NSRect)dirtyRect {
  NSRect bounds = self.bounds;
  NSBezierPath *clip = [NSBezierPath bezierPathWithRoundedRect:bounds xRadius:7 yRadius:7];
  [NSGraphicsContext saveGraphicsState];
  [clip addClip];
  if (self.image && self.image.size.width > 0 && self.image.size.height > 0) {
    NSSize s = self.image.size;
    CGFloat scale = MAX(NSWidth(bounds) / s.width, NSHeight(bounds) / s.height);
    NSSize crop = NSMakeSize(NSWidth(bounds) / scale, NSHeight(bounds) / scale);
    NSRect source = NSMakeRect((s.width - crop.width) / 2, (s.height - crop.height) / 2, crop.width, crop.height);
    [self.image drawInRect:bounds fromRect:source operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
  } else {
    NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:HDDark(self.effectiveAppearance) ? HDHex(@"#2C2540") : HDHex(@"#E4DAF6")
                                                         endingColor:HDDark(self.effectiveAppearance) ? HDHex(@"#1A1626") : HDHex(@"#CDBFEA")];
    [gradient drawInRect:bounds angle:-70];
    NSString *text = self.placeholder ?: @"No preview";
    NSDictionary *attributes = @{NSFontAttributeName:[NSFont systemFontOfSize:10.5 weight:NSFontWeightMedium], NSForegroundColorAttributeName:HDMuted()};
    NSSize size = [text sizeWithAttributes:attributes];
    [text drawAtPoint:NSMakePoint(NSMidX(bounds) - size.width / 2, NSMidY(bounds) - size.height / 2) withAttributes:attributes];
  }
  if (self.emoteText.length) {
    NSGradient *scrim = [[NSGradient alloc] initWithStartingColor:[NSColor colorWithWhite:0 alpha:0.62] endingColor:[NSColor colorWithWhite:0 alpha:0]];
    [scrim drawInRect:NSMakeRect(0, 0, NSWidth(bounds), 46) angle:90];
    NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
    paragraph.lineBreakMode = NSLineBreakByTruncatingTail;
    [self.emoteText drawInRect:NSMakeRect(8, 6, NSWidth(bounds) - 16, 14) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:10.5 weight:NSFontWeightSemibold], NSForegroundColorAttributeName:NSColor.whiteColor, NSParagraphStyleAttributeName:paragraph}];
  }
  [NSGraphicsContext restoreGraphicsState];
  NSFont *badge = [NSFont systemFontOfSize:10 weight:NSFontWeightSemibold];
  NSColor *glass = [NSColor colorWithWhite:0 alpha:0.62];
  CGFloat y = NSMaxY(bounds) - 22;
  if (self.peakText.length) HDDrawPill(self.peakText, NSMakePoint(6, y), badge, glass, NSColor.whiteColor, HDSpikeViolet([NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]));
  if (self.statusText.length) {
    NSSize size = [self.statusText sizeWithAttributes:@{NSFontAttributeName:badge}];
    CGFloat width = ceil(size.width) + 14 + 11;
    HDDrawPill(self.statusText, NSMakePoint(NSMaxX(bounds) - 6 - width, y - (self.peakText.length ? 24 : 0)), badge, glass, NSColor.whiteColor, self.statusColor ?: HDGood());
  }
  [HDHairline() setStroke];
  NSBezierPath *border = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(bounds, 0.5, 0.5) xRadius:7 yRadius:7];
  border.lineWidth = 1; [border stroke];
}
@end

@interface HDSidebarTintView : NSView
@end
@implementation HDSidebarTintView
- (CALayer *)makeBackingLayer { return [CAGradientLayer layer]; }
- (BOOL)wantsUpdateLayer { return YES; }
- (void)updateLayer {
  CAGradientLayer *layer = (CAGradientLayer *)self.layer;
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    BOOL dark = HDDark(self.effectiveAppearance);
    NSColor *top = [HDAccent() colorWithAlphaComponent:dark ? 0.22 : 0.10];
    layer.colors = @[(id)top.CGColor, (id)[HDAccent() colorWithAlphaComponent:0].CGColor];
  }];
  layer.startPoint = CGPointMake(0.5, 1);
  layer.endPoint = CGPointMake(0.5, 0.5);
}
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay = YES; }
@end

@interface HDUI ()
@property(strong) NSWindow *window;
@property(strong) NSStackView *recentRows;
@property(strong) NSView *libraryEmptyView;
@property(strong) NSScrollView *libraryScroll;
@property(strong) NSTextField *libraryEmptyTitle;
@property(strong) NSTextField *libraryEmptyBody;
@property(strong) NSButton *libraryEmptyAction;
@property(strong) NSStackView *storageAdvancedOptions;
@property(strong) NSStackView *advancedOptions;
@property(strong) NSArray<NSDictionary *> *recentEntries;
@property(strong) NSTextField *sessionSummary;
@property(strong) NSTextField *licenseTerms;
@property(strong) NSStackView *licenseEntry;
@property(strong) NSStackView *licenseActions;
@property(strong) NSStackView *storageFolderRow;
@property(strong) NSButton *localFolderButton;
@property(strong) NSTextField *localOutputPathLabel;
@property(strong) NSStackView *localOutputBox;
@property(strong) NSStackView *onboardingStorageRow;
@property(weak) id target;
@property(strong) NSView *sidebar;
@property(strong) NSView *pageHost;
@property(strong) NSView *capturePage;
@property(strong) NSView *clipsPage;
@property(strong) NSView *storagePage;
@property(strong) NSView *licensePage;
@property(strong) NSView *settingsPage;
@property(strong) NSMutableArray<HDNavButton *> *navButtons;
@property(strong) NSStackView *sidebarStatusStack;
@property(strong) NSTextField *sidebarStatusText;
@property(strong) NSTextField *sidebarAccountText;
@property(strong) NSImageView *sidebarStatusIcon;
@property(strong) NSView *offerCard;
@property(strong) NSTextField *offerLabel;
@property(strong) NSButton *offerBuyButton;
@property(strong) NSButton *offerKeyButton;
@property(strong) NSImageView *licenseStatusIcon;
@property(strong) NSWindow *onboardingWindow;
@property(strong) NSTextField *captureHeroTitle;
@property(strong) NSTextField *captureHeroSubtitle;
@property(strong) NSTextField *clipMetric;
@property(strong) NSTextField *queueMetric;
@property(strong) NSTextField *storageMetric;
@property(strong) NSTextField *trialMetric;
@property(strong) NSTextField *clipsMetricCaption;
@property(strong) NSTextField *queueMetricCaption;
@property(strong) NSTextField *storageMetricCaption;
@property(strong) NSTextField *trialMetricCaption;
@property(strong) NSImageView *recentEmptyIcon;
@property(strong) HDCardView *selectedStorageCard;
@property(strong) NSMutableArray<NSButton *> *storageCardButtons;
@property(strong) NSMutableArray<NSImageView *> *storageSelectionBadges;
@property(strong) NSTextField *onboardingTitle;
@property(strong) NSTextField *onboardingBody;
@property(strong) NSButton *onboardingContinue;
@property(strong) NSButton *onboardingBack;
@property NSInteger onboardingStep;
@property(strong) NSStackView *liveBox;
@property(strong) NSStackView *vodBox;
@property(strong) NSStackView *vodOptionsBox;
@property(strong) NSButton *vodOptionsDisclosure;
@property BOOL liveRunning;
@property(strong) HDChatPulseView *chatPulse;
@property(copy) NSString *summaryBase;
@property(copy) NSString *planNoteText;
@property(strong) HDLayoutPreviewView *layoutPreview;
@property(strong) NSSegmentedControl *layoutModeControl;
@property(strong) NSSegmentedControl *cornerTopControl;
@property(strong) NSSegmentedControl *cornerBottomControl;
@property(strong) NSSlider *camRatioSlider;
@property(strong) NSTextField *camRatioValue;
@property(strong) NSTextField *reframeNote;
@property(copy) NSString *reframeLayoutValue;
@property double reframeRatioValue;
@property(copy) NSString *reframeCornerValue;
@property(strong) HDCardView *previewPane;
@property(strong) AVPlayerView *previewPlayerView;
@property(strong) NSTextField *previewTitle;
@property(strong) NSButton *previewToggle;
@property(copy) NSString *previewPath;
@property(copy) NSString *previewEntryTitle;
@property BOOL previewCollapsed;
@end


@implementation HDUI

- (instancetype)initWithTarget:(id)target {
  self = [super init];
  if (!self) return nil;
  _target = target;
  _navButtons = [NSMutableArray array];
  _storageCardButtons = [NSMutableArray array];
  _storageSelectionBadges = [NSMutableArray array];
  [self buildWindow];
  [self buildSidebar];
  [self buildCapturePage];
  [self buildClipsPage];
  [self buildStoragePage];
  [self buildLicensePage];
  [self buildSettingsPage];
  for (NSView *page in @[self.capturePage, self.storagePage, self.licensePage, self.settingsPage]) {
    NSScrollView *scroll = page.subviews.firstObject;
    NSStackView *stack = (NSStackView *)scroll.documentView.subviews.firstObject;
    if ([stack isKindOfClass:NSStackView.class] && stack.arrangedSubviews.count) [stack setCustomSpacing:4 afterView:stack.arrangedSubviews.firstObject];
  }
  [self selectPage:HDPageCapture];
  [self.window makeFirstResponder:nil];
  return self;
}

- (void)buildWindow {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1080, 720)
                                                 styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.title = @"ClipSpike";
  window.titleVisibility = NSWindowTitleHidden;
  window.titlebarAppearsTransparent = YES;
  window.movableByWindowBackground = NO;
  window.minSize = NSMakeSize(960, 640);
  window.releasedWhenClosed = NO;
  [window setFrameAutosaveName:@"HDMainWindow"];
  if (window.frame.size.width < 960 || window.frame.size.height < 640) {
    [window setContentSize:NSMakeSize(1080, 720)];
  }
  self.window = window;

  // The root stays unpainted so the sidebar's behind-window vibrancy can show through.
  NSView *contentRoot = window.contentView;
  NSView *root = [[NSView alloc] initWithFrame:contentRoot.bounds];
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [contentRoot addSubview:root];

  NSVisualEffectView *sidebar = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
  sidebar.material = NSVisualEffectMaterialSidebar;
  sidebar.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  sidebar.state = NSVisualEffectStateActive;
  sidebar.translatesAutoresizingMaskIntoConstraints = NO;
  sidebar.accessibilityLabel = @"Sidebar";
  [root addSubview:sidebar];
  self.sidebar = sidebar;
  HDSidebarTintView *tint = [[HDSidebarTintView alloc] initWithFrame:NSZeroRect];
  tint.wantsLayer = YES;
  tint.translatesAutoresizingMaskIntoConstraints = NO;
  [sidebar addSubview:tint];
  [NSLayoutConstraint activateConstraints:@[
    [tint.leadingAnchor constraintEqualToAnchor:sidebar.leadingAnchor],
    [tint.trailingAnchor constraintEqualToAnchor:sidebar.trailingAnchor],
    [tint.topAnchor constraintEqualToAnchor:sidebar.topAnchor],
    [tint.bottomAnchor constraintEqualToAnchor:sidebar.bottomAnchor]
  ]];

  NSView *content = [[HDCanvasView alloc] initWithFrame:NSZeroRect];
  content.translatesAutoresizingMaskIntoConstraints = NO;
  content.wantsLayer = YES;
  content.layer.backgroundColor = HDInk().CGColor;
  [root addSubview:content];

  HDRuleView *divider = [[HDRuleView alloc] initWithFrame:NSZeroRect];
  divider.translatesAutoresizingMaskIntoConstraints = NO;
  divider.wantsLayer = YES;
  [root addSubview:divider];

  [NSLayoutConstraint activateConstraints:@[
    [sidebar.leadingAnchor constraintEqualToAnchor:root.leadingAnchor],
    [sidebar.topAnchor constraintEqualToAnchor:root.topAnchor],
    [sidebar.bottomAnchor constraintEqualToAnchor:root.bottomAnchor],
    [sidebar.widthAnchor constraintEqualToConstant:204],
    [content.leadingAnchor constraintEqualToAnchor:sidebar.trailingAnchor],
    [divider.leadingAnchor constraintEqualToAnchor:sidebar.trailingAnchor],
    [divider.topAnchor constraintEqualToAnchor:root.topAnchor],
    [divider.bottomAnchor constraintEqualToAnchor:root.bottomAnchor],
    [divider.widthAnchor constraintEqualToConstant:1],
    [content.trailingAnchor constraintEqualToAnchor:root.trailingAnchor],
    [content.topAnchor constraintEqualToAnchor:root.topAnchor],
    [content.bottomAnchor constraintEqualToAnchor:root.bottomAnchor]
  ]];

  NSView *pageHost = [[NSView alloc] initWithFrame:NSZeroRect];
  pageHost.translatesAutoresizingMaskIntoConstraints = NO;
  [content addSubview:pageHost];
  self.pageHost = pageHost;
  [NSLayoutConstraint activateConstraints:@[
    [pageHost.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
    [pageHost.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],
    [pageHost.topAnchor constraintEqualToAnchor:content.topAnchor],
    [pageHost.bottomAnchor constraintEqualToAnchor:content.bottomAnchor]
  ]];
}

- (void)buildSidebar {
  NSStackView *stack = [NSStackView new];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 5;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [self.sidebar addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.leadingAnchor constraintEqualToAnchor:self.sidebar.leadingAnchor constant:14],
    [stack.trailingAnchor constraintEqualToAnchor:self.sidebar.trailingAnchor constant:-14],
    [stack.topAnchor constraintEqualToAnchor:self.sidebar.topAnchor constant:52],
    [stack.bottomAnchor constraintEqualToAnchor:self.sidebar.bottomAnchor constant:-18]
  ]];
  NSStackView *brand = [NSStackView new];
  brand.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  brand.alignment = NSLayoutAttributeCenterY; brand.spacing = 8;
  NSImageView *icon = [NSImageView new]; icon.image = NSApp.applicationIconImage;
  [icon.widthAnchor constraintEqualToConstant:28].active = YES;
  [icon.heightAnchor constraintEqualToConstant:28].active = YES;
  [brand addArrangedSubview:icon];
  [brand addArrangedSubview:HDLabel(@"ClipSpike", 13, NSFontWeightSemibold, NSColor.labelColor)];
  [stack addArrangedSubview:brand]; [stack setCustomSpacing:24 afterView:brand];
  NSArray *items = @[
    @[@"Capture", @(HDSymbolRoleCapture), @(HDPageCapture)],
    @[@"Clips", @(HDSymbolRoleClips), @(HDPageClips)],
    @[@"Storage", @(HDSymbolRoleStorage), @(HDPageStorage)]
  ];
  for (NSArray *item in items) {
    HDNavButton *button = [[HDNavButton alloc] initWithTitle:item[0] role:[item[1] integerValue] target:self action:@selector(navClicked:)];
    button.tag = [item[2] integerValue]; [self.navButtons addObject:button];
    [stack addArrangedSubview:button];
    [button.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  }
  [stack addArrangedSubview:[self flexSpacer]];
  NSBox *footerRule = [NSBox new];
  footerRule.boxType = NSBoxSeparator;
  [stack addArrangedSubview:footerRule];
  [footerRule.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [stack setCustomSpacing:10 afterView:footerRule];
  NSStackView *status = [NSStackView new]; status.spacing = 7;
  status.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  status.alignment = NSLayoutAttributeCenterY;
  self.sidebarStatusIcon = HDSymbolImageView(HDSymbolRoleStatusReady, 11, NSColor.secondaryLabelColor, @"Capture status");
  self.sidebarStatusText = HDLabel(@"Idle", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
  [status addArrangedSubview:self.sidebarStatusIcon]; [status addArrangedSubview:self.sidebarStatusText];
  [stack addArrangedSubview:status];
  self.sidebarAccountText = HDLabel(@"", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
  self.sidebarAccountText.lineBreakMode = NSLineBreakByTruncatingTail;
  [stack addArrangedSubview:self.sidebarAccountText];
  [stack setCustomSpacing:12 afterView:self.sidebarAccountText];
  HDNavButton *settings = [[HDNavButton alloc] initWithTitle:@"Settings" role:HDSymbolRoleSettings target:self action:@selector(settingsClicked:)];
  settings.tag = HDPageSettings; [self.navButtons addObject:settings];
  [stack addArrangedSubview:settings]; [settings.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
}

- (void)navClicked:(HDNavButton *)sender {
  [self selectPage:(HDPage)sender.tag];
}

- (void)settingsClicked:(id)sender {
  [self selectPage:HDPageSettings];
}

- (void)selectPage:(HDPage)page {
  NSArray *pages = @[self.capturePage, self.clipsPage, self.storagePage, self.licensePage, self.settingsPage];
  for (NSInteger i = 0; i < pages.count; i++) {
    NSView *view = pages[i];
    if (!view) continue;
    view.hidden = (i != (NSInteger)page);
  }
  if (page != HDPageClips) [self stopClipPreview];
  for (HDNavButton *button in self.navButtons) {
    [button setSelectedAppearance:button.tag == (NSInteger)page || (page == HDPageLicense && button.tag == HDPageSettings)];
  }
  if (page == HDPageClips && [self.target respondsToSelector:@selector(reloadHistoryFromDisk)]) {
    [self.target performSelector:@selector(reloadHistoryFromDisk)];
  } else if (page == HDPageStorage && [self.target respondsToSelector:@selector(reloadStorageSettings)]) {
    [self.target performSelector:@selector(reloadStorageSettings)];
  } else if (page == HDPageLicense && [self.target respondsToSelector:@selector(updateLicenseUI)]) {
    [self.target performSelector:@selector(updateLicenseUI)];
  }
  if ([self.target respondsToSelector:@selector(uiPageSelected:)]) {
    [self.target performSelector:@selector(uiPageSelected:) withObject:@(page)];
  }
  self.window.title = @[@"Capture", @"Clips", @"Storage", @"License", @"Settings"][page];
}

- (HDPage)selectedPage {
  for (NSInteger i = 0; i < 5; i++) {
    NSArray *pages = @[self.capturePage, self.clipsPage, self.storagePage, self.licensePage, self.settingsPage];
    if (![pages[i] isHidden]) return (HDPage)i;
  }
  return HDPageCapture;
}

- (HDCardView *)card {
  HDCardView *card = [[HDCardView alloc] initWithFrame:NSZeroRect];
  card.translatesAutoresizingMaskIntoConstraints = NO;
  return card;
}

- (NSStackView *)titleRowWithRole:(HDSymbolRole)role title:(NSString *)title {
  (void)role;
  NSStackView *row = [[NSStackView alloc] init];
  row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  row.alignment = NSLayoutAttributeCenterY;
  [row addArrangedSubview:HDLabel(title, 24, NSFontWeightSemibold, NSColor.labelColor)];
  return row;
}

- (NSStackView *)formPage:(NSView **)outPage compact:(BOOL)compact {
  NSView *page = [NSView new]; page.translatesAutoresizingMaskIntoConstraints = NO;
  [self.pageHost addSubview:page];
  [NSLayoutConstraint activateConstraints:@[
    [page.leadingAnchor constraintEqualToAnchor:self.pageHost.leadingAnchor],
    [page.trailingAnchor constraintEqualToAnchor:self.pageHost.trailingAnchor],
    [page.topAnchor constraintEqualToAnchor:self.pageHost.topAnchor],
    [page.bottomAnchor constraintEqualToAnchor:self.pageHost.bottomAnchor]
  ]];
  *outPage = page;
  NSScrollView *scroll = [NSScrollView new]; scroll.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.drawsBackground = NO; scroll.hasVerticalScroller = YES; scroll.autohidesScrollers = YES;
  scroll.automaticallyAdjustsContentInsets = NO;
  [page addSubview:scroll];
  [NSLayoutConstraint activateConstraints:@[
    [scroll.leadingAnchor constraintEqualToAnchor:page.leadingAnchor],
    [scroll.trailingAnchor constraintEqualToAnchor:page.trailingAnchor],
    [scroll.topAnchor constraintEqualToAnchor:page.topAnchor constant:24],
    [scroll.bottomAnchor constraintEqualToAnchor:page.bottomAnchor]
  ]];
  HDDocumentView *doc = [HDDocumentView new]; doc.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.documentView = doc;
  [doc.widthAnchor constraintEqualToAnchor:scroll.contentView.widthAnchor].active = YES;
  NSStackView *stack = [NSStackView new];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical; stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 20; stack.translatesAutoresizingMaskIntoConstraints = NO; [doc addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.leadingAnchor constraintEqualToAnchor:doc.leadingAnchor constant:28],
    [stack.trailingAnchor constraintLessThanOrEqualToAnchor:doc.trailingAnchor constant:-28],
    [stack.topAnchor constraintEqualToAnchor:doc.topAnchor constant:20],
    [stack.bottomAnchor constraintEqualToAnchor:doc.bottomAnchor constant:-28]
  ]];
  if (compact) {
    NSLayoutConstraint *width = [stack.widthAnchor constraintEqualToConstant:660]; width.priority = 750; width.active = YES;
  } else [stack.trailingAnchor constraintEqualToAnchor:doc.trailingAnchor constant:-28].active = YES;
  return stack;
}

- (NSStackView *)insetStack:(NSView *)container {
  NSStackView *stack = [NSStackView new];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical; stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 12; stack.translatesAutoresizingMaskIntoConstraints = NO; [container addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.leadingAnchor constraintEqualToAnchor:container.leadingAnchor constant:18],
    [stack.trailingAnchor constraintEqualToAnchor:container.trailingAnchor constant:-18],
    [stack.topAnchor constraintEqualToAnchor:container.topAnchor constant:18],
    [stack.bottomAnchor constraintEqualToAnchor:container.bottomAnchor constant:-18]
  ]];
  return stack;
}

- (void)buildCapturePage {
  NSView *page; NSStackView *stack = [self formPage:&page compact:NO]; self.capturePage = page;
  [stack addArrangedSubview:[self titleRowWithRole:HDSymbolRoleCapture title:@"Capture"]];

  HDCardView *offer = [self card];
  self.offerCard = offer;
  offer.hidden = YES;
  NSStackView *offerRow = [self insetStack:offer];
  offerRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  offerRow.alignment = NSLayoutAttributeCenterY;
  offerRow.spacing = 8;
  self.offerLabel = HDLabel(@"", 13, NSFontWeightMedium, NSColor.labelColor);
  self.offerLabel.maximumNumberOfLines = 2;
  self.offerLabel.lineBreakMode = NSLineBreakByWordWrapping;
  [self.offerLabel setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  self.offerBuyButton = HDButton(@"Buy a license", self.target, @selector(buyLicense:), YES);
  self.offerKeyButton = HDButton(@"Enter license key", self.target, @selector(showLicense:), NO);
  [offerRow addArrangedSubview:self.offerLabel];
  [offerRow addArrangedSubview:self.offerBuyButton];
  [offerRow addArrangedSubview:self.offerKeyButton];
  [stack addArrangedSubview:offer];
  [offer.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;

  [stack addArrangedSubview:HDLabel(@"Start a capture on a live channel. Chat spikes save a vertical clip on their own. Save highlight now keeps a moment the chat missed.", 12, NSFontWeightRegular, NSColor.secondaryLabelColor)];

  NSStackView *channelBox = [NSStackView new];
  channelBox.orientation = NSUserInterfaceLayoutOrientationVertical;
  channelBox.alignment = NSLayoutAttributeLeading;
  channelBox.spacing = 8;
  [channelBox addArrangedSubview:HDLabel(@"Live channel", 11, NSFontWeightSemibold, NSColor.secondaryLabelColor)];
  NSStackView *input = [NSStackView new];
  input.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  input.alignment = NSLayoutAttributeCenterY;
  input.spacing = 8;
  self.channelField = [NSTextField textFieldWithString:[[NSUserDefaults standardUserDefaults] stringForKey:@"channel"] ?: @""];
  self.channelField.placeholderString = @"Twitch username or Kick channel URL";
  self.channelField.font = [NSFont systemFontOfSize:14];
  self.channelField.bezelStyle = NSTextFieldRoundedBezel;
  self.channelField.accessibilityLabel = @"Live channel username or URL";
  self.channelField.target = self;
  self.channelField.action = @selector(channelChanged:);
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(channelChanged:) name:NSControlTextDidChangeNotification object:self.channelField];
  [self.channelField.heightAnchor constraintEqualToConstant:36].active = YES;
  self.toggleButton = HDButtonWithSymbol(@"Start capture", self.target, @selector(toggleCapture:), YES, HDSymbolRoleRecord);
  [self.toggleButton.widthAnchor constraintEqualToConstant:144].active = YES;
  [input addArrangedSubview:self.channelField];
  [input addArrangedSubview:self.toggleButton];
  [channelBox addArrangedSubview:input];
  [input.widthAnchor constraintEqualToAnchor:channelBox.widthAnchor].active = YES;
  [channelBox addArrangedSubview:HDCaption(@"Twitch: enter a username. Kick: paste the channel URL (requires a paired relay).")];

  self.captureModeControl = [NSSegmentedControl segmentedControlWithLabels:@[@"Live Stream", @"Past Broadcast"] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(captureModeChanged:)];
  self.captureModeControl.controlSize = NSControlSizeRegular;
  HDStyleSegmented(self.captureModeControl);
  self.captureModeControl.accessibilityLabel = @"Capture source";
  self.captureModeControl.font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
  self.captureModeControl.selectedSegment = [[NSUserDefaults standardUserDefaults] integerForKey:@"captureMode"] == 1 ? 1 : 0;
  [stack addArrangedSubview:self.captureModeControl];

  self.liveBox = channelBox;
  [stack addArrangedSubview:channelBox];
  [channelBox.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;

  // VOD mode: one link, one button; everything else sits behind Options.
  NSStackView *vodBox = [NSStackView new];
  vodBox.orientation = NSUserInterfaceLayoutOrientationVertical;
  vodBox.alignment = NSLayoutAttributeLeading;
  vodBox.spacing = 7;
  [vodBox addArrangedSubview:HDLabel(@"Twitch VOD", 11, NSFontWeightSemibold, NSColor.secondaryLabelColor)];
  NSStackView *vodInput = [NSStackView new];
  vodInput.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  vodInput.alignment = NSLayoutAttributeCenterY;
  vodInput.spacing = 10;
  self.vodField = [NSTextField textFieldWithString:@""];
  self.vodField.placeholderString = @"Paste a Twitch VOD link";
  self.vodField.font = [NSFont systemFontOfSize:14];
  self.vodField.bezelStyle = NSTextFieldRoundedBezel;
  self.vodField.accessibilityLabel = @"Twitch VOD URL";
  [self.vodField.heightAnchor constraintEqualToConstant:36].active = YES;
  self.vodButton = HDButtonWithSymbol(@"Find Highlights", self.target, @selector(findHighlights:), YES, HDSymbolRoleRecord);
  [self.vodButton.widthAnchor constraintEqualToConstant:152].active = YES;
  [vodInput addArrangedSubview:self.vodField];
  [vodInput addArrangedSubview:self.vodButton];
  [vodBox addArrangedSubview:vodInput];
  [vodInput.widthAnchor constraintEqualToAnchor:vodBox.widthAnchor].active = YES;

  NSStackView *disclosureRow = [NSStackView new];
  disclosureRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  disclosureRow.alignment = NSLayoutAttributeCenterY;
  disclosureRow.spacing = 2;
  self.vodOptionsDisclosure = [NSButton buttonWithTitle:@"" target:self action:@selector(vodOptionsToggled:)];
  self.vodOptionsDisclosure.bezelStyle = NSBezelStyleDisclosure;
  [self.vodOptionsDisclosure setButtonType:NSButtonTypePushOnPushOff];
  self.vodOptionsDisclosure.state = NSControlStateValueOff;
  NSButton *optionsTitle = [NSButton buttonWithTitle:@"Options" target:self action:@selector(vodOptionsTitleClicked:)];
  optionsTitle.bordered = NO;
  optionsTitle.font = [NSFont systemFontOfSize:12];
  [disclosureRow addArrangedSubview:self.vodOptionsDisclosure];
  [disclosureRow addArrangedSubview:optionsTitle];
  [vodBox addArrangedSubview:disclosureRow];

  self.vodOptionsBox = [NSStackView new];
  self.vodOptionsBox.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.vodOptionsBox.alignment = NSLayoutAttributeLeading;
  self.vodOptionsBox.spacing = 8;
  NSStackView *topRow = [NSStackView new];
  topRow.alignment = NSLayoutAttributeCenterY;
  topRow.spacing = 6;
  NSTextField *topLabel = HDLabel(@"Top moments", 12, NSFontWeightRegular, NSColor.labelColor);
  [topLabel.widthAnchor constraintEqualToConstant:90].active = YES;
  self.vodTopValue = [NSTextField textFieldWithString:@"15"];
  self.vodTopValue.font = [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightRegular];
  self.vodTopValue.alignment = NSTextAlignmentRight;
  self.vodTopValue.target = self;
  self.vodTopValue.action = @selector(vodTopTyped:);
  [self.vodTopValue.widthAnchor constraintEqualToConstant:44].active = YES;
  self.vodTopStepper = [NSStepper new];
  self.vodTopStepper.minValue = 1;
  self.vodTopStepper.maxValue = 50;
  self.vodTopStepper.increment = 1;
  self.vodTopStepper.integerValue = 15;
  self.vodTopStepper.valueWraps = NO;
  self.vodTopStepper.target = self;
  self.vodTopStepper.action = @selector(vodTopStepped:);
  [topRow addArrangedSubview:topLabel];
  [topRow addArrangedSubview:self.vodTopValue];
  [topRow addArrangedSubview:self.vodTopStepper];
  [self.vodOptionsBox addArrangedSubview:topRow];
  NSStackView *rangeRow = [NSStackView new];
  rangeRow.alignment = NSLayoutAttributeCenterY;
  rangeRow.spacing = 6;
  NSTextField *startLabel = HDLabel(@"Start", 12, NSFontWeightRegular, NSColor.labelColor);
  [startLabel.widthAnchor constraintEqualToConstant:90].active = YES;
  self.vodStartField = [NSTextField textFieldWithString:@""];
  self.vodStartField.placeholderString = @"h:mm:ss";
  self.vodStartField.font = [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightRegular];
  [self.vodStartField.widthAnchor constraintEqualToConstant:84].active = YES;
  NSTextField *endLabel = HDLabel(@"End", 12, NSFontWeightRegular, NSColor.labelColor);
  self.vodEndField = [NSTextField textFieldWithString:@""];
  self.vodEndField.placeholderString = @"h:mm:ss";
  self.vodEndField.font = [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightRegular];
  [self.vodEndField.widthAnchor constraintEqualToConstant:84].active = YES;
  [rangeRow addArrangedSubview:startLabel];
  [rangeRow addArrangedSubview:self.vodStartField];
  [rangeRow addArrangedSubview:endLabel];
  [rangeRow addArrangedSubview:self.vodEndField];
  [self.vodOptionsBox addArrangedSubview:rangeRow];
  [self.vodOptionsBox addArrangedSubview:HDCaption(@"Leave Start and End empty to scan the whole VOD.")];
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  self.vodCaptionsCheckbox = [NSButton checkboxWithTitle:@"Burn in captions" target:self action:@selector(vodOverlayChanged:)];
  self.vodCaptionsCheckbox.state = [defaults boolForKey:@"vodCaptions"] ? NSControlStateValueOn : NSControlStateValueOff;
  [self.vodOptionsBox addArrangedSubview:self.vodCaptionsCheckbox];
  NSStackView *hookRow = [NSStackView new];
  hookRow.alignment = NSLayoutAttributeCenterY;
  hookRow.spacing = 8;
  self.vodHookCheckbox = [NSButton checkboxWithTitle:@"Add hook line" target:self action:@selector(vodOverlayChanged:)];
  self.vodHookCheckbox.state = [defaults boolForKey:@"vodHook"] ? NSControlStateValueOn : NSControlStateValueOff;
  self.vodHookTextField = [NSTextField textFieldWithString:@""];
  self.vodHookTextField.placeholderString = @"Auto from chat";
  self.vodHookTextField.font = [NSFont systemFontOfSize:12];
  [self.vodHookTextField.widthAnchor constraintEqualToConstant:240].active = YES;
  [hookRow addArrangedSubview:self.vodHookCheckbox];
  [hookRow addArrangedSubview:self.vodHookTextField];
  [self.vodOptionsBox addArrangedSubview:hookRow];
  self.vodHookTextField.hidden = self.vodHookCheckbox.state != NSControlStateValueOn;
  self.vodOptionsBox.hidden = YES;
  [vodBox addArrangedSubview:self.vodOptionsBox];

  self.vodBox = vodBox;
  [stack addArrangedSubview:vodBox];
  [vodBox.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [self syncCaptureMode];

  HDCardView *sessionCard = [self card];
  [stack addArrangedSubview:sessionCard];
  [sessionCard.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSStackView *sessionContent = [self insetStack:sessionCard];
  sessionContent.spacing = 12;

  NSStackView *sessionRow = [NSStackView new];
  sessionRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  sessionRow.alignment = NSLayoutAttributeCenterY;
  sessionRow.spacing = 16;
  NSStackView *sessionText = [NSStackView new];
  sessionText.orientation = NSUserInterfaceLayoutOrientationVertical;
  sessionText.alignment = NSLayoutAttributeLeading;
  sessionText.spacing = 4;
  self.captureHeroTitle = HDLabel(@"Ready to start", 16, NSFontWeightSemibold, NSColor.labelColor);
  self.captureHeroSubtitle = HDLabel(@"Start capture and keep ClipSpike running while the stream is live.", 12, NSFontWeightRegular, NSColor.secondaryLabelColor);
  [sessionText addArrangedSubview:self.captureHeroTitle];
  [sessionText addArrangedSubview:self.captureHeroSubtitle];
  [self.captureHeroSubtitle.widthAnchor constraintEqualToAnchor:sessionText.widthAnchor].active = YES;
  self.statusLabel = [HDEventLabel labelWithString:@""];
  self.statusLabel.font = [NSFont systemFontOfSize:11];
  self.statusLabel.textColor = NSColor.secondaryLabelColor;
  [sessionText addArrangedSubview:self.statusLabel];
  self.telemetryLabel = [HDEventLabel labelWithString:@""];
  self.telemetryLabel.font = HDMono(11);
  self.telemetryLabel.textColor = NSColor.secondaryLabelColor;
  [sessionText addArrangedSubview:self.telemetryLabel];
  [sessionRow addArrangedSubview:sessionText];
  [sessionText.widthAnchor constraintEqualToAnchor:sessionRow.widthAnchor].active = YES;
  for (NSTextField *label in @[self.captureHeroTitle, self.statusLabel, self.telemetryLabel]) {
    label.maximumNumberOfLines = 0;
    label.lineBreakMode = NSLineBreakByWordWrapping;
    [label.widthAnchor constraintEqualToAnchor:sessionText.widthAnchor].active = YES;
    [label setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  }
  NSStackView *actions = [NSStackView new];
  actions.spacing = 6;
  self.saveButton = HDButtonWithSymbol(@"Save highlight now", self.target, @selector(saveHighlight:), NO, HDSymbolRoleSave);
  self.saveButton.toolTip = @"Save a highlight during capture (⌘S).";
  self.missedButton = HDButton(@"Mark missed moment", self.target, @selector(markMissedMoment:), NO);
  self.missedButton.toolTip = @"Records this time for review. It does not save a clip.";
  self.lastClipButton = HDButtonWithSymbol(@"Open Last Clip", self.target, @selector(openLastClip:), NO, HDSymbolRoleOpenClip);
  self.lastClipButton.toolTip = @"Available after a clip has finished.";
  self.saveButton.enabled = NO;
  self.missedButton.enabled = NO;
  self.lastClipButton.enabled = NO;
  [actions addArrangedSubview:self.saveButton];
  [actions addArrangedSubview:self.missedButton];
  [actions addArrangedSubview:self.lastClipButton];
  NSButton *monitorButton = HDButton(@"Capture Health…", self.target, @selector(showMonitoring:), NO);
  monitorButton.toolTip = @"Capture health, clip feedback and per-channel learning";
  [actions addArrangedSubview:monitorButton];
  [sessionContent addArrangedSubview:sessionRow];
  self.chatPulse = [[HDChatPulseView alloc] initWithFrame:NSZeroRect];
  [sessionContent addArrangedSubview:self.chatPulse];
  [self.chatPulse.widthAnchor constraintEqualToAnchor:sessionContent.widthAnchor].active = YES;
  [sessionContent addArrangedSubview:actions];
  [sessionRow.widthAnchor constraintEqualToAnchor:sessionContent.widthAnchor].active = YES;
  self.sessionSummary = HDCaption(@"0 clips saved · No pending uploads");
  self.sessionSummary.font = HDTabular(11);
  [sessionContent addArrangedSubview:self.sessionSummary];
  [self.sessionSummary.widthAnchor constraintEqualToAnchor:sessionContent.widthAnchor].active = YES;

  NSStackView *recentHeader = [NSStackView new];
  recentHeader.alignment = NSLayoutAttributeCenterY;
  [recentHeader addArrangedSubview:HDLabel(@"Recent clips", 13, NSFontWeightSemibold, NSColor.labelColor)];
  [recentHeader addArrangedSubview:[NSView new]];
  [recentHeader addArrangedSubview:HDButtonWithSymbol(@"View Library", self, @selector(openClipsPage:), NO, HDSymbolRoleArrowRight)];
  [stack addArrangedSubview:recentHeader];
  [recentHeader.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  self.recentRows = [NSStackView new];
  self.recentRows.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.recentRows.alignment = NSLayoutAttributeLeading;
  self.recentRows.spacing = 12;
  [stack addArrangedSubview:self.recentRows];
  [self.recentRows.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [self updateRecentClips:@[]];
  [self syncCaptureMode];
  [self setSessionState:HDSessionStateReady status:@""];
}
- (void)channelChanged:(id)sender {
  if (self.channelField.enabled) [self setSessionState:HDSessionStateReady status:@""];
}

- (BOOL)vodMode { return self.captureModeControl.selectedSegment == 1; }

- (void)captureModeChanged:(id)sender {
  [[NSUserDefaults standardUserDefaults] setInteger:self.captureModeControl.selectedSegment forKey:@"captureMode"];
  [self syncCaptureMode];
  if (!self.liveRunning && !self.vodRunning) [self setSessionState:HDSessionStateReady status:@""];
}

- (void)syncCaptureMode {
  BOOL vod = self.vodMode;
  self.liveBox.hidden = vod;
  self.vodBox.hidden = !vod;
  self.saveButton.hidden = vod;
  self.chatPulse.hidden = vod;
  // Source changes are user initiated; initial construction must not steal focus.
  if (self.window.isVisible && self.selectedPage == HDPageCapture)
    [self.window makeFirstResponder:vod ? self.vodField : self.channelField];
}

- (void)vodOptionsToggled:(id)sender {
  self.vodOptionsBox.hidden = self.vodOptionsDisclosure.state != NSControlStateValueOn;
}

- (void)vodOptionsTitleClicked:(id)sender {
  self.vodOptionsDisclosure.state = self.vodOptionsDisclosure.state == NSControlStateValueOn ? NSControlStateValueOff : NSControlStateValueOn;
  [self vodOptionsToggled:nil];
}

- (void)vodOverlayChanged:(id)sender {
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  [defaults setBool:self.vodCaptionsCheckbox.state == NSControlStateValueOn forKey:@"vodCaptions"];
  [defaults setBool:self.vodHookCheckbox.state == NSControlStateValueOn forKey:@"vodHook"];
  self.vodHookTextField.hidden = self.vodHookCheckbox.state != NSControlStateValueOn;
}

- (void)vodTopStepped:(id)sender { self.vodTopValue.integerValue = self.vodTopStepper.integerValue; }

- (void)vodTopTyped:(id)sender {
  NSInteger value = MAX(1, MIN(50, self.vodTopValue.integerValue));
  self.vodTopStepper.integerValue = value;
  self.vodTopValue.integerValue = value;
}

- (NSInteger)vodTopCount {
  [self vodTopTyped:nil];
  return self.vodTopStepper.integerValue;
}

- (void)setVodRunning:(BOOL)running {
  _vodRunning = running;
  self.vodField.enabled = !running;
  self.vodStartField.enabled = !running;
  self.vodEndField.enabled = !running;
  self.vodTopValue.enabled = !running;
  self.vodTopStepper.enabled = !running;
  self.vodCaptionsCheckbox.enabled = !running;
  self.vodHookCheckbox.enabled = !running;
  self.vodHookTextField.enabled = !running;
  self.vodButton.title = running ? @"Cancel" : @"Find Highlights";
  self.vodButton.image = HDSymbolImage(running ? HDSymbolRoleStop : HDSymbolRoleRecord, 13, NSFontWeightSemibold, running ? @"Cancel" : @"Find highlights");
  self.vodButton.imagePosition = NSImageLeading;
  self.vodButton.imageHugsTitle = YES;
  self.toggleButton.enabled = !running;
  self.toggleButton.toolTip = running ? @"Finish or cancel the VOD scan first." : nil;
}

- (void)refreshRecentPreviews { [self updateRecentClips:self.recentEntries ?: @[]]; }

- (void)updateRecentClips:(NSArray<NSDictionary *> *)entries {
  self.recentEntries = entries;
  for (NSView *view in self.recentRows.arrangedSubviews.copy) { [self.recentRows removeArrangedSubview:view]; [view removeFromSuperview]; }
  if (!entries.count) {
    [self.recentRows addArrangedSubview:HDLabel(@"No clips yet", 13, NSFontWeightMedium, NSColor.labelColor)];
    [self.recentRows addArrangedSubview:HDCaption(@"Highlights appear automatically when chat reacts. You can also save one with ⌘S during capture.")];
    return;
  }
  NSStackView *strip = [NSStackView new];
  strip.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  strip.alignment = NSLayoutAttributeTop;
  strip.spacing = 14;
  NSUInteger count = MIN((NSUInteger)3, entries.count);
  for (NSUInteger index = 0; index < count; index++) [strip addArrangedSubview:[self clipCardForEntry:entries[index] index:(NSInteger)index]];
  [self.recentRows addArrangedSubview:strip];
}

// A 9:16 portrait card: cached thumbnail, peak-chatter badge, status pill, one-click Open.
- (NSView *)clipCardForEntry:(NSDictionary *)entry index:(NSInteger)index {
  HDCardView *card = [self card];
  [card.widthAnchor constraintEqualToConstant:136].active = YES;
  NSStackView *stack = [NSStackView new];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 8;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [card addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:8],
    [stack.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-8],
    [stack.topAnchor constraintEqualToAnchor:card.topAnchor constant:8],
    [stack.bottomAnchor constraintEqualToAnchor:card.bottomAnchor constant:-8]
  ]];
  NSString *path = [entry[@"localPath"] isKindOfClass:NSString.class] ? entry[@"localPath"] : @"";
  NSString *reason = [entry[@"reason"] isKindOfClass:NSString.class] ? entry[@"reason"] : @"Highlight";
  NSString *status = [entry[@"status"] isKindOfClass:NSString.class] ? entry[@"status"] : @"saved";
  BOOL local = path.length && [[NSFileManager defaultManager] fileExistsAtPath:path];

  HDClipThumbView *thumb = [[HDClipThumbView alloc] initWithFrame:NSZeroRect];
  thumb.translatesAutoresizingMaskIntoConstraints = NO;
  [thumb.widthAnchor constraintEqualToConstant:120].active = YES;
  [thumb.heightAnchor constraintEqualToConstant:213].active = YES; // 9:16
  if (local && [self.target respondsToSelector:@selector(cachedClipPreview:)]) {
    thumb.image = [self.target performSelector:@selector(cachedClipPreview:) withObject:path];
  }
  thumb.placeholder = local ? @"Loading preview…" : @"Cloud only";
  NSNumber *peak = [entry[@"peak"] isKindOfClass:NSNumber.class] ? entry[@"peak"] : nil;
  if (peak.integerValue > 0) thumb.peakText = [NSString stringWithFormat:@"%ld chatting", (long)peak.integerValue];
  thumb.statusText = status.capitalizedString;
  thumb.statusColor = HDSymbolColorForStatus(status);
  NSMutableArray<NSString *> *emotes = [NSMutableArray array];
  if ([entry[@"topEmotes"] isKindOfClass:NSArray.class]) {
    for (NSDictionary *emote in entry[@"topEmotes"]) {
      if (![emote isKindOfClass:NSDictionary.class] || emotes.count >= 2) continue;
      [emotes addObject:[NSString stringWithFormat:@"%@ ×%ld", emote[@"name"] ?: @"", (long)[emote[@"count"] integerValue]]];
    }
  }
  thumb.emoteText = [emotes componentsJoinedByString:@"  "];
  __weak typeof(self) weakSelf = self;
  thumb.onClick = ^{ [weakSelf openRecentEntryAtIndex:index]; };
  thumb.accessibilityElement = YES;
  thumb.accessibilityRole = NSAccessibilityButtonRole;
  thumb.accessibilityLabel = [NSString stringWithFormat:@"Open clip: %@", reason];
  thumb.accessibilityValue = [NSString stringWithFormat:@"%@%@", status.capitalizedString, peak.integerValue > 0 ? [NSString stringWithFormat:@", %ld chatters at peak", (long)peak.integerValue] : @""];
  thumb.toolTip = reason;
  [stack addArrangedSubview:thumb];

  NSTextField *title = HDLabel(reason, 11.5, NSFontWeightMedium, NSColor.labelColor);
  title.maximumNumberOfLines = 1;
  title.lineBreakMode = NSLineBreakByTruncatingTail;
  title.toolTip = reason;
  [title.widthAnchor constraintEqualToConstant:120].active = YES;
  [stack addArrangedSubview:title];
  NSButton *open = HDButtonWithSymbol(@"Open", self, @selector(openRecentClip:), NO, HDSymbolRoleOpenClip);
  open.tag = index;
  open.accessibilityLabel = [NSString stringWithFormat:@"Open clip %@", reason];
  [open.widthAnchor constraintEqualToConstant:120].active = YES;
  [stack addArrangedSubview:open];
  return card;
}

- (void)openRecentClip:(NSButton *)sender { [self openRecentEntryAtIndex:sender.tag]; }

- (void)openRecentEntryAtIndex:(NSInteger)index {
  if (index < 0 || index >= (NSInteger)self.recentEntries.count) return;
  NSDictionary *entry = self.recentEntries[index];
  if ([self.target respondsToSelector:@selector(recentClipOpened:)]) [self.target performSelector:@selector(recentClipOpened:) withObject:entry];
  NSString *path = [entry[@"localPath"] isKindOfClass:NSString.class] ? entry[@"localPath"] : @"";
  NSString *link = [entry[@"webLink"] isKindOfClass:NSString.class] ? entry[@"webLink"] : @"";
  if (path.length && [[NSFileManager defaultManager] fileExistsAtPath:path])
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
  else if (link.length) [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:link]];
  else [self selectPage:HDPageClips];
}

- (void)openClipsPage:(id)sender {
  [self selectPage:HDPageClips];
}

- (void)buildClipsPage {
  NSView *page = [[NSView alloc] initWithFrame:NSZeroRect];
  page.translatesAutoresizingMaskIntoConstraints = NO;
  page.hidden = YES;
  [self.pageHost addSubview:page];
  [NSLayoutConstraint activateConstraints:@[
    [page.leadingAnchor constraintEqualToAnchor:self.pageHost.leadingAnchor],
    [page.trailingAnchor constraintEqualToAnchor:self.pageHost.trailingAnchor],
    [page.topAnchor constraintEqualToAnchor:self.pageHost.topAnchor],
    [page.bottomAnchor constraintEqualToAnchor:self.pageHost.bottomAnchor]
  ]];
  self.clipsPage = page;

  NSStackView *stack = [[NSStackView alloc] init];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 14;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [page addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.leadingAnchor constraintEqualToAnchor:page.leadingAnchor constant:28],
    [stack.trailingAnchor constraintEqualToAnchor:page.trailingAnchor constant:-28],
    [stack.topAnchor constraintEqualToAnchor:page.topAnchor constant:44],
    [stack.bottomAnchor constraintEqualToAnchor:page.bottomAnchor constant:-24]
  ]];

  NSStackView *header = [[NSStackView alloc] init];
  header.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  header.alignment = NSLayoutAttributeCenterY;
  NSStackView *titleBox = [[NSStackView alloc] init];
  titleBox.orientation = NSUserInterfaceLayoutOrientationVertical;
  titleBox.alignment = NSLayoutAttributeLeading;
  titleBox.spacing = 3;
  [titleBox addArrangedSubview:[self titleRowWithRole:HDSymbolRoleClips title:@"Clips"]];
  [titleBox addArrangedSubview:HDLabel(@"Every highlight, local and in the cloud.", 13, NSFontWeightRegular, NSColor.secondaryLabelColor)];
  [header addArrangedSubview:titleBox];
  [header addArrangedSubview:[[NSView alloc] initWithFrame:NSZeroRect]];
  NSButton *openFolder = HDButtonWithSymbol(@"Open Clips Folder", self.target, @selector(folder:), NO, HDSymbolRoleFolder);
  [header addArrangedSubview:openFolder];
  [stack addArrangedSubview:header];
  [header.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;

  NSStackView *tools = [[NSStackView alloc] init];
  tools.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  tools.spacing = 8;
  self.clipSearchField = [[NSSearchField alloc] initWithFrame:NSZeroRect];
  self.clipSearchField.placeholderString = @"Search clips";
  self.clipSearchField.target = self.target;
  self.clipSearchField.action = @selector(clipSearchChanged:);
  self.clipSearchField.translatesAutoresizingMaskIntoConstraints = NO;
  self.clipSearchField.accessibilityLabel = @"Search clips";
  [self.clipSearchField.widthAnchor constraintGreaterThanOrEqualToConstant:180].active = YES;
  [tools addArrangedSubview:self.clipSearchField];

  self.clipFilterControl = [NSSegmentedControl segmentedControlWithLabels:@[@"All", @"Local Only", @"Cloud", @"Queued"]
                                                            trackingMode:NSSegmentSwitchTrackingSelectOne
                                                                  target:self.target
                                                                  action:@selector(clipFilterChanged:)];
  self.clipFilterControl.selectedSegment = 0;
  [tools addArrangedSubview:self.clipFilterControl];
  HDStyleSegmented(self.clipFilterControl);
  [stack addArrangedSubview:tools];
  [tools.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;

  self.historyStatus = HDLabel(@"", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
  self.historyStatus.font = HDTabular(11);
  [stack addArrangedSubview:self.historyStatus];

  NSTableView *table = [[NSTableView alloc] initWithFrame:NSZeroRect];
  table.rowHeight = 48;
  table.usesAlternatingRowBackgroundColors = NO;
  table.backgroundColor = HDInk();
  table.gridColor = HDHairline();
  table.gridStyleMask = NSTableViewSolidHorizontalGridLineMask;
  table.intercellSpacing = NSMakeSize(0, 0);
  if (@available(macOS 11.0, *)) table.style = NSTableViewStylePlain;
  table.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
  table.selectionHighlightStyle = NSTableViewSelectionHighlightStyleRegular;
  table.doubleAction = @selector(openSelectedHistory:);
  table.target = self.target;
  table.translatesAutoresizingMaskIntoConstraints = NO;
  NSArray *columns = @[
    @[@"preview", @"", @64.0],
    @[@"when", @"Created", @128.0],
    @[@"chatrate", @"Peak", @56.0],
    @[@"size", @"Size", @60.0],
    @[@"provider", @"Destination", @124.0],
    @[@"local", @"Local", @104.0],
    @[@"rating", @"", @64.0]
  ];
  for (NSArray *spec in columns) {
    NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:spec[0]];
    column.title = spec[1];
    column.width = [spec[2] doubleValue];
    column.minWidth = [spec[0] isEqualToString:@"when"] ? 112 : ([spec[0] isEqualToString:@"provider"] ? 124 : ([spec[0] isEqualToString:@"local"] ? 100 : ([spec[0] isEqualToString:@"preview"] ? 64 : 56)));
    if ([spec[0] isEqualToString:@"rating"]) {
      column.maxWidth = 72;
      column.headerToolTip = @"Optional: rate clips to help tune highlight picking. Stays on this Mac.";
      [table addTableColumn:column];
      continue;
    }
    if ([spec[0] isEqualToString:@"when"] || [spec[0] isEqualToString:@"provider"]) {
      NSString *key = [spec[0] isEqualToString:@"when"] ? @"createdAt" : spec[0];
      column.sortDescriptorPrototype = [NSSortDescriptor sortDescriptorWithKey:key ascending:![key isEqualToString:@"createdAt"] selector:@selector(localizedStandardCompare:)];
    }
    [table addTableColumn:column];
  }
  table.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"createdAt" ascending:NO]];
  NSMenu *context = [NSMenu new];
  NSArray *actions = @[@[@"Open Clip", @"openSelectedHistory:"], @[@"Show in Finder", @"revealSelectedClip:"], @[@"Copy Cloud Link", @"copySelectedClipLink:"], @[@"Clip Details…", @"showSelectedClipDetails:"]];
  for (NSArray *spec in actions) { NSMenuItem *item = [context addItemWithTitle:spec[0] action:NSSelectorFromString(spec[1]) keyEquivalent:@""]; item.target = self.target; }
  [context addItem:[NSMenuItem separatorItem]];
  for (NSArray *spec in @[@[@"Duplicate", @"markDuplicate:"], @[@"Started Late", @"markStartedLate:"], @[@"Ended Early", @"markEndedEarly:"]]) {
    NSMenuItem *item = [context addItemWithTitle:spec[0] action:NSSelectorFromString(spec[1]) keyEquivalent:@""];
    item.target = self.target;
  }
  table.menu = context;
  self.historyTable = table;
  NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSZeroRect];
  scroll.documentView = table;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  scroll.borderType = NSNoBorder;
  scroll.translatesAutoresizingMaskIntoConstraints = NO;
  self.previewCollapsed = [[NSUserDefaults standardUserDefaults] boolForKey:@"clipPreviewCollapsed"];
  NSStackView *libraryRow = [[NSStackView alloc] init];
  libraryRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  libraryRow.alignment = NSLayoutAttributeTop;
  libraryRow.spacing = 14;
  [stack addArrangedSubview:libraryRow];
  [libraryRow.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [libraryRow setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
  [libraryRow addArrangedSubview:scroll];
  [scroll.heightAnchor constraintGreaterThanOrEqualToConstant:240].active = YES;
  [scroll.heightAnchor constraintEqualToAnchor:libraryRow.heightAnchor].active = YES;
  [scroll setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  self.libraryScroll = scroll;
  // Replace the empty table with one useful next step, in the same available space.
  HDCardView *empty = [self card];
  [empty.heightAnchor constraintGreaterThanOrEqualToConstant:240].active = YES;
  NSStackView *message = [NSStackView new];
  message.orientation = NSUserInterfaceLayoutOrientationVertical;
  message.alignment = NSLayoutAttributeCenterX;
  message.spacing = 12;
  message.translatesAutoresizingMaskIntoConstraints = NO;
  [empty addSubview:message];
  [message addArrangedSubview:HDSymbolImageView(HDSymbolRoleClips, 28, HDAccentText(), @"Clip library")];
  self.libraryEmptyTitle = HDLabel(@"Your highlights start here", 16, NSFontWeightSemibold, NSColor.labelColor);
  self.libraryEmptyBody = HDLabel(@"Capture a live stream or find moments in a past broadcast.", 13, NSFontWeightRegular, NSColor.secondaryLabelColor);
  self.libraryEmptyBody.alignment = NSTextAlignmentCenter;
  self.libraryEmptyAction = HDButton(@"Go to Capture", self, @selector(libraryEmptyClicked:), YES);
  [message addArrangedSubview:self.libraryEmptyTitle];
  [message addArrangedSubview:self.libraryEmptyBody];
  [message addArrangedSubview:self.libraryEmptyAction];
  [NSLayoutConstraint activateConstraints:@[
    [message.centerXAnchor constraintEqualToAnchor:empty.centerXAnchor],
    [message.centerYAnchor constraintEqualToAnchor:empty.centerYAnchor],
    [message.widthAnchor constraintLessThanOrEqualToAnchor:empty.widthAnchor constant:-40],
    [self.libraryEmptyBody.widthAnchor constraintEqualToAnchor:message.widthAnchor]
  ]];
  [libraryRow insertArrangedSubview:empty atIndex:0];
  [empty.heightAnchor constraintEqualToAnchor:libraryRow.heightAnchor].active = YES;
  [empty setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  self.libraryEmptyView = empty;

  // Collapsible quick-preview pane for the selected local clip.
  HDCardView *pane = [self card];
  pane.hidden = YES;
  [libraryRow addArrangedSubview:pane];
  [pane.widthAnchor constraintEqualToConstant:248].active = YES;
  [pane.heightAnchor constraintEqualToAnchor:libraryRow.heightAnchor].active = YES;
  self.previewPane = pane;
  NSTextField *previewTitle = HDLabel(@"Clip preview", 12, NSFontWeightSemibold, NSColor.labelColor);
  previewTitle.maximumNumberOfLines = 1;
  previewTitle.lineBreakMode = NSLineBreakByTruncatingTail;
  previewTitle.translatesAutoresizingMaskIntoConstraints = NO;
  [previewTitle setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  self.previewTitle = previewTitle;
  NSButton *closePreview = [NSButton buttonWithImage:HDSymbolImage(HDSymbolRoleDisconnect, 13, NSFontWeightMedium, @"Hide preview") target:self action:@selector(togglePreviewPane:)];
  closePreview.bordered = NO;
  closePreview.contentTintColor = NSColor.secondaryLabelColor;
  closePreview.accessibilityLabel = @"Hide preview";
  closePreview.toolTip = @"Hide preview";
  closePreview.translatesAutoresizingMaskIntoConstraints = NO;
  AVPlayerView *player = [[AVPlayerView alloc] initWithFrame:NSZeroRect];
  player.controlsStyle = AVPlayerViewControlsStyleInline;
  player.videoGravity = AVLayerVideoGravityResizeAspect;
  player.showsFullScreenToggleButton = NO;
  player.translatesAutoresizingMaskIntoConstraints = NO;
  player.wantsLayer = YES;
  player.layer.cornerRadius = 8;
  player.layer.masksToBounds = YES;
  player.accessibilityLabel = @"Clip preview player";
  self.previewPlayerView = player;
  [pane addSubview:previewTitle]; [pane addSubview:closePreview]; [pane addSubview:player];
  [NSLayoutConstraint activateConstraints:@[
    [previewTitle.leadingAnchor constraintEqualToAnchor:pane.leadingAnchor constant:12],
    [previewTitle.trailingAnchor constraintEqualToAnchor:closePreview.leadingAnchor constant:-6],
    [previewTitle.topAnchor constraintEqualToAnchor:pane.topAnchor constant:12],
    [closePreview.trailingAnchor constraintEqualToAnchor:pane.trailingAnchor constant:-8],
    [closePreview.centerYAnchor constraintEqualToAnchor:previewTitle.centerYAnchor],
    [closePreview.widthAnchor constraintEqualToConstant:24],
    [closePreview.heightAnchor constraintEqualToConstant:24],
    [player.leadingAnchor constraintEqualToAnchor:pane.leadingAnchor constant:12],
    [player.trailingAnchor constraintEqualToAnchor:pane.trailingAnchor constant:-12],
    [player.topAnchor constraintEqualToAnchor:previewTitle.bottomAnchor constant:10],
    [player.bottomAnchor constraintEqualToAnchor:pane.bottomAnchor constant:-12]
  ]];

  NSStackView *footer = [[NSStackView alloc] init];
  footer.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  footer.spacing = 10;
  self.historyOpenButton = HDButtonWithSymbol(@"Open Selected", self.target, @selector(openSelectedHistory:), NO, HDSymbolRoleOpenSelected);
  self.historyOpenButton.enabled = NO;
  [footer addArrangedSubview:self.historyOpenButton];
  NSButton *refresh = HDButtonWithSymbol(@"Refresh", self.target, @selector(refreshHistory:), NO, HDSymbolRoleRefresh);
  [footer addArrangedSubview:refresh];
  self.previewToggle = HDButtonWithSymbol(self.previewCollapsed ? @"Show Preview" : @"Hide Preview", self, @selector(togglePreviewPane:), NO, HDSymbolRoleOpenClip);
  self.previewToggle.enabled = NO;
  self.previewToggle.toolTip = @"Watch the selected clip here before opening it elsewhere.";
  [footer addArrangedSubview:self.previewToggle];
  NSButton *state = HDButtonWithSymbol(@"Open State Folder", self.target, @selector(openStateFolder:), NO, HDSymbolRoleStateFolder);
  state.hidden = YES;
  [stack addArrangedSubview:footer];
}


- (void)setPreviewPaneVisible:(BOOL)visible {
  self.previewPane.hidden = !visible;
  // Make room for the pane at the minimum window width by hiding the secondary columns.
  for (NSString *identifier in @[@"chatrate", @"size", @"local"]) [[self.historyTable tableColumnWithIdentifier:identifier] setHidden:visible];
}

- (void)releasePreviewPlayer {
  [self.previewPlayerView.player pause];
  self.previewPlayerView.player = nil;
}

- (void)stopClipPreview { [self.previewPlayerView.player pause]; }

- (void)syncPreviewToggle {
  self.previewToggle.enabled = self.previewPath.length > 0;
  self.previewToggle.title = self.previewCollapsed ? @"Show Preview" : @"Hide Preview";
}

- (void)loadPreviewPlayer {
  if (!self.previewPath.length || self.previewCollapsed) { [self releasePreviewPlayer]; return; }
  AVAsset *current = self.previewPlayerView.player.currentItem.asset;
  if ([current isKindOfClass:AVURLAsset.class] && [((AVURLAsset *)current).URL.path isEqualToString:self.previewPath]) return;
  [self.previewPlayerView.player pause];
  self.previewPlayerView.player = [AVPlayer playerWithURL:[NSURL fileURLWithPath:self.previewPath]];
}

- (void)showClipPreviewForEntry:(NSDictionary *)entry {
  NSString *path = [entry[@"localPath"] isKindOfClass:NSString.class] ? entry[@"localPath"] : @"";
  BOOL local = path.length && [[NSFileManager defaultManager] fileExistsAtPath:path];
  self.previewPath = local ? path : nil;
  NSString *reason = [entry[@"reason"] isKindOfClass:NSString.class] ? entry[@"reason"] : @"Clip preview";
  self.previewTitle.stringValue = reason;
  self.previewTitle.toolTip = reason;
  [self setPreviewPaneVisible:local && !self.previewCollapsed];
  [self loadPreviewPlayer];
  [self syncPreviewToggle];
}

- (void)togglePreviewPane:(id)sender {
  self.previewCollapsed = !self.previewCollapsed;
  [[NSUserDefaults standardUserDefaults] setBool:self.previewCollapsed forKey:@"clipPreviewCollapsed"];
  [self setPreviewPaneVisible:self.previewPath.length > 0 && !self.previewCollapsed];
  [self loadPreviewPlayer];
  [self syncPreviewToggle];
}

- (NSView *)flexSpacer {
  NSView *spacer = [[NSView alloc] initWithFrame:NSZeroRect];
  spacer.translatesAutoresizingMaskIntoConstraints = NO;
  [spacer setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
  [spacer.heightAnchor constraintGreaterThanOrEqualToConstant:0].active = YES;
  return spacer;
}

- (void)buildStoragePage {
  NSView *page; NSStackView *stack = [self formPage:&page compact:YES]; self.storagePage = page;
  [stack addArrangedSubview:[self titleRowWithRole:HDSymbolRoleStorage title:@"Storage"]];
  [stack addArrangedSubview:HDLabel(@"Choose where finished 9:16 clips go.", 13, NSFontWeightRegular, NSColor.secondaryLabelColor)];

  NSPopUpButton *hidden = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
  [hidden addItemsWithTitles:@[@"Local only", @"Dropbox", @"Google Drive"]];
  hidden.hidden = YES;
  [stack addArrangedSubview:hidden];
  self.storageModePopup = hidden;

  NSStackView *cards = [[NSStackView alloc] init];
  cards.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  cards.distribution = NSStackViewDistributionFillEqually;
  cards.spacing = 12;
  [stack addArrangedSubview:cards];
  [cards.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSArray *titles = @[@"Local only", @"Dropbox", @"Google Drive"];
  NSArray *roles = @[@(HDSymbolRoleStorageLocal), @(HDSymbolRoleStorageDropbox), @(HDSymbolRoleStorageGoogle)];
  for (NSInteger i = 0; i < 3; i++) {
    NSButton *button = [NSButton buttonWithTitle:@"" target:self action:@selector(storageCardClicked:)];
    button.tag = i;
    button.accessibilityLabel = titles[i];
    button.toolTip = [NSString stringWithFormat:@"Save finished clips to %@", titles[i]];
    button.bordered = NO;
    button.wantsLayer = YES;
    button.layer.cornerRadius = 0;
    button.translatesAutoresizingMaskIntoConstraints = NO;
    [button.heightAnchor constraintEqualToConstant:86].active = YES;
    HDCardView *card = [self card];
    [cards addArrangedSubview:card];
    [card.widthAnchor constraintEqualToAnchor:cards.widthAnchor multiplier:1.0/3.0 constant:-8].active = YES;
    [card addSubview:button];
    [NSLayoutConstraint activateConstraints:@[
      [button.leadingAnchor constraintEqualToAnchor:card.leadingAnchor],
      [button.trailingAnchor constraintEqualToAnchor:card.trailingAnchor],
      [button.topAnchor constraintEqualToAnchor:card.topAnchor],
      [button.bottomAnchor constraintEqualToAnchor:card.bottomAnchor]
    ]];
    [self.storageCardButtons addObject:button];
    NSStackView *box = [[NSStackView alloc] init];
    box.orientation = NSUserInterfaceLayoutOrientationVertical;
    box.alignment = NSLayoutAttributeLeading;
    box.spacing = 4;
    box.translatesAutoresizingMaskIntoConstraints = NO;
    [card addSubview:box];
    [NSLayoutConstraint activateConstraints:@[
      [box.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:14],
      [box.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-14],
      [box.centerYAnchor constraintEqualToAnchor:card.centerYAnchor]
    ]];
    NSImageView *icon = HDSymbolImageView([roles[i] integerValue], 16, HDMuted(), titles[i]);
    [box addArrangedSubview:icon];
    [box addArrangedSubview:HDLabel(titles[i], 14, NSFontWeightSemibold, NSColor.labelColor)];
    NSTextField *detail = HDLabel(i == 0 ? @"No account needed" : @"Browser sign-in", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
    [box addArrangedSubview:detail];
    NSImageView *badge = HDSymbolImageView(HDSymbolRoleStorageSelected, 14, HDAccentText(), @"Selected destination");
    badge.hidden = YES;
    [card addSubview:badge];
    [NSLayoutConstraint activateConstraints:@[
      [badge.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-12],
      [badge.topAnchor constraintEqualToAnchor:card.topAnchor constant:12]
    ]];
    [self.storageSelectionBadges addObject:badge];
  }

  HDCardView *form = [self card];
  [stack addArrangedSubview:form];
  [form.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSStackView *formStack = [[NSStackView alloc] init];
  formStack.orientation = NSUserInterfaceLayoutOrientationVertical;
  formStack.alignment = NSLayoutAttributeLeading;
  formStack.spacing = 10;
  formStack.translatesAutoresizingMaskIntoConstraints = NO;
  [form addSubview:formStack];
  [NSLayoutConstraint activateConstraints:@[
    [formStack.leadingAnchor constraintEqualToAnchor:form.leadingAnchor constant:18],
    [formStack.trailingAnchor constraintEqualToAnchor:form.trailingAnchor constant:-18],
    [formStack.topAnchor constraintEqualToAnchor:form.topAnchor constant:16],
    [formStack.bottomAnchor constraintEqualToAnchor:form.bottomAnchor constant:-16]
  ]];
  self.storageStatus = HDLabel(@"", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
  [formStack addArrangedSubview:self.storageStatus];
  NSStackView *folderRow = [[NSStackView alloc] init];
  self.storageFolderRow = folderRow;
  folderRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  folderRow.spacing = 10;
  [folderRow addArrangedSubview:HDSymbolImageView(HDSymbolRoleFolder, 12, NSColor.secondaryLabelColor, @"Remote folder")];
  [folderRow addArrangedSubview:HDLabel(@"Remote folder", 12, NSFontWeightSemibold, NSColor.secondaryLabelColor)];
  self.storageFolder = [NSTextField textFieldWithString:@"/ClipSpike"];
  self.storageFolder.font = HDMono(12);
  self.storageFolder.translatesAutoresizingMaskIntoConstraints = NO;
  [self.storageFolder.widthAnchor constraintGreaterThanOrEqualToConstant:260].active = YES;
  [folderRow addArrangedSubview:self.storageFolder];
  [formStack addArrangedSubview:folderRow];
  self.storageDeleteCheckbox = [NSButton checkboxWithTitle:@"Delete local videos after confirmed upload" target:nil action:nil];
  self.storageKeepLocalCheckbox = [NSButton checkboxWithTitle:@"Keep a local copy after uploading" target:nil action:nil];
  self.storageKeepRawCheckbox = [NSButton checkboxWithTitle:@"Keep original landscape files" target:nil action:nil];
  self.storageDeleteCheckbox.hidden = YES;
  [formStack addArrangedSubview:self.storageKeepLocalCheckbox];
  NSButton *advanced = [NSButton checkboxWithTitle:@"Show advanced file options" target:self action:@selector(storageAdvancedChanged:)];
  [formStack addArrangedSubview:advanced];
  self.storageAdvancedOptions = [NSStackView new]; self.storageAdvancedOptions.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.storageAdvancedOptions.alignment = NSLayoutAttributeLeading; self.storageAdvancedOptions.spacing = 5;
  [self.storageAdvancedOptions addArrangedSubview:self.storageKeepRawCheckbox];
  [self.storageAdvancedOptions addArrangedSubview:HDCaption(@"Retains the landscape source in addition to the vertical clip. Uses more disk space.")];
  [formStack addArrangedSubview:self.storageAdvancedOptions]; self.storageAdvancedOptions.hidden = YES;
  self.storageKeepRawCheckbox.toolTip = @"Keeps the landscape source as well as the finished vertical clip. Uses additional disk space.";
  self.localFolderButton = HDButtonWithSymbol(@"Open Save Folder", self.target, @selector(folder:), NO, HDSymbolRoleFolder);
  self.localOutputBox = [NSStackView new];
  self.localOutputBox.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.localOutputBox.alignment = NSLayoutAttributeLeading; self.localOutputBox.spacing = 8;
  [self.localOutputBox addArrangedSubview:HDLabel(@"Save folder", 12, NSFontWeightMedium, NSColor.labelColor)];
  self.localOutputPathLabel = HDCaption(@"");
  self.localOutputPathLabel.font = HDMono(11);
  [self setLocalOutputPath:[[NSUserDefaults standardUserDefaults] stringForKey:@"HDOutputRoot"] ?: [HDMigration defaultOutputPath]];
  [self.localOutputBox addArrangedSubview:self.localOutputPathLabel];
  self.localOutputPathLabel.maximumNumberOfLines = 1;
  self.localOutputPathLabel.lineBreakMode = NSLineBreakByTruncatingMiddle;
  [self.localOutputPathLabel.widthAnchor constraintEqualToAnchor:self.localOutputBox.widthAnchor].active = YES;
  NSStackView *folderActions = [NSStackView new]; folderActions.spacing = 8;
  [folderActions addArrangedSubview:HDButton(@"Choose Folder…", self.target, @selector(chooseOutputFolder:), NO)];
  [folderActions addArrangedSubview:self.localFolderButton];
  [self.localOutputBox addArrangedSubview:folderActions];
  [formStack insertArrangedSubview:self.localOutputBox atIndex:1];
  [self.localOutputBox.widthAnchor constraintEqualToAnchor:formStack.widthAnchor].active = YES;
  NSStackView *actions = [[NSStackView alloc] init];
  actions.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  actions.spacing = 8;
  self.storageConnectButton = HDButtonWithSymbol(@"Connect", self.target, @selector(connectStorage:), YES, HDSymbolRoleConnect);
  self.storageDisconnectButton = HDButtonWithSymbol(@"Disconnect", self.target, @selector(disconnectStorage:), NO, HDSymbolRoleDisconnect);
  NSButton *save = HDButtonWithSymbol(@"Save Changes", self.target, @selector(saveStorageSettings:), NO, HDSymbolRoleSaveChanges);
  [actions addArrangedSubview:self.storageConnectButton];
  [actions addArrangedSubview:self.storageDisconnectButton];
  self.storageSaveButton = save; save.enabled = NO;
  self.storageKeepLocalCheckbox.target = self.target; self.storageKeepLocalCheckbox.action = @selector(storagePreferencesChanged:);
  self.storageKeepRawCheckbox.target = self.target; self.storageKeepRawCheckbox.action = @selector(storagePreferencesChanged:);
  [[NSNotificationCenter defaultCenter] addObserver:self.target selector:@selector(storagePreferencesChanged:) name:NSControlTextDidChangeNotification object:self.storageFolder];
  [actions addArrangedSubview:save];
  [formStack addArrangedSubview:actions];
  [self buildReframeCardInto:stack];
}

- (NSTextField *)sectionCaption:(NSString *)text {
  return HDLabel(text, 11, NSFontWeightSemibold, NSColor.secondaryLabelColor);
}

- (void)buildReframeCardInto:(NSStackView *)stack {
  HDCardView *card = [self card];
  [stack addArrangedSubview:card];
  [card.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSStackView *box = [self insetStack:card];
  box.spacing = 12;
  [box addArrangedSubview:HDLabel(@"Vertical layout", 14, NSFontWeightSemibold, NSColor.labelColor)];
  NSTextField *intro = HDCaption(@"Choose how the 16:9 stream becomes a 9:16 clip.");
  [box addArrangedSubview:intro];
  NSStackView *row = [NSStackView new];
  row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  row.alignment = NSLayoutAttributeTop;
  row.spacing = 22;
  [box addArrangedSubview:row];
  [row.widthAnchor constraintEqualToAnchor:box.widthAnchor].active = YES;

  self.layoutPreview = [[HDLayoutPreviewView alloc] initWithFrame:NSZeroRect];
  [self.layoutPreview.widthAnchor constraintEqualToConstant:330].active = YES;
  [self.layoutPreview.heightAnchor constraintEqualToConstant:236].active = YES;
  __weak typeof(self) weakSelf = self;
  self.layoutPreview.cornerPicked = ^(NSString *corner) {
    weakSelf.reframeCornerValue = corner;
    [weakSelf syncReframeControls];
    [weakSelf pushReframeChange];
  };
  [row addArrangedSubview:self.layoutPreview];

  NSStackView *controls = [NSStackView new];
  controls.orientation = NSUserInterfaceLayoutOrientationVertical;
  controls.alignment = NSLayoutAttributeLeading;
  controls.spacing = 8;
  [row addArrangedSubview:controls];
  [controls setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [controls.widthAnchor constraintGreaterThanOrEqualToConstant:230].active = YES;

  [controls addArrangedSubview:[self sectionCaption:@"Layout"]];
  self.layoutModeControl = [NSSegmentedControl segmentedControlWithLabels:@[@"Blur fill", @"Split facecam"] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(reframeLayoutChanged:)];
  HDStyleSegmented(self.layoutModeControl);
  self.layoutModeControl.accessibilityLabel = @"Vertical layout";
  [controls addArrangedSubview:self.layoutModeControl];
  [self.layoutModeControl.widthAnchor constraintEqualToAnchor:controls.widthAnchor].active = YES;
  [controls setCustomSpacing:14 afterView:self.layoutModeControl];

  [controls addArrangedSubview:[self sectionCaption:@"Facecam corner"]];
  self.cornerTopControl = [NSSegmentedControl segmentedControlWithLabels:@[@"Top left", @"Top right"] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(reframeCornerChanged:)];
  self.cornerBottomControl = [NSSegmentedControl segmentedControlWithLabels:@[@"Bottom left", @"Bottom right"] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(reframeCornerChanged:)];
  self.cornerTopControl.accessibilityLabel = @"Facecam corner, top";
  self.cornerBottomControl.accessibilityLabel = @"Facecam corner, bottom";
  for (NSSegmentedControl *control in @[self.cornerTopControl, self.cornerBottomControl]) {
    HDStyleSegmented(control);
    [controls addArrangedSubview:control];
    [control.widthAnchor constraintEqualToAnchor:controls.widthAnchor].active = YES;
  }
  [controls setCustomSpacing:14 afterView:self.cornerBottomControl];

  NSStackView *ratioHeader = [NSStackView new];
  ratioHeader.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  ratioHeader.alignment = NSLayoutAttributeCenterY;
  [ratioHeader addArrangedSubview:[self sectionCaption:@"Facecam height"]];
  [ratioHeader addArrangedSubview:[NSView new]];
  self.camRatioValue = HDLabel(@"35%", 12, NSFontWeightMedium, NSColor.labelColor);
  self.camRatioValue.font = HDTabular(12);
  [ratioHeader addArrangedSubview:self.camRatioValue];
  [controls addArrangedSubview:ratioHeader];
  [ratioHeader.widthAnchor constraintEqualToAnchor:controls.widthAnchor].active = YES;
  self.camRatioSlider = [NSSlider sliderWithValue:0.35 minValue:0.20 maxValue:0.50 target:self action:@selector(reframeRatioChanged:)];
  self.camRatioSlider.continuous = YES;
  self.camRatioSlider.trackFillColor = HDAccent();
  self.camRatioSlider.accessibilityLabel = @"Facecam height";
  [controls addArrangedSubview:self.camRatioSlider];
  [self.camRatioSlider.widthAnchor constraintEqualToAnchor:controls.widthAnchor].active = YES;

  self.reframeNote = HDCaption(@"Saved to your configuration. Applies the next time capture starts.");
  [controls addArrangedSubview:self.reframeNote];
  [self.reframeNote.widthAnchor constraintEqualToAnchor:controls.widthAnchor].active = YES;

  self.reframeLayoutValue = @"blur"; self.reframeRatioValue = 0.35; self.reframeCornerValue = @"bottom-left";
  [self syncReframeControls];
}

- (void)syncReframeControls {
  BOOL split = [self.reframeLayoutValue isEqualToString:@"split"];
  self.layoutModeControl.selectedSegment = split ? 1 : 0;
  NSInteger corner = [HDCornerNames() indexOfObject:self.reframeCornerValue];
  if (corner == NSNotFound) corner = 2;
  self.cornerTopControl.selectedSegment = corner < 2 ? corner : -1;
  self.cornerBottomControl.selectedSegment = corner >= 2 ? corner - 2 : -1;
  self.cornerTopControl.enabled = split;
  self.cornerBottomControl.enabled = split;
  self.camRatioSlider.enabled = split;
  self.camRatioSlider.doubleValue = self.reframeRatioValue;
  self.camRatioValue.stringValue = [NSString stringWithFormat:@"%.0f%%", self.reframeRatioValue * 100];
  self.camRatioValue.textColor = split ? NSColor.labelColor : NSColor.tertiaryLabelColor;
  self.camRatioSlider.accessibilityValueDescription = self.camRatioValue.stringValue;
  self.layoutPreview.layout = self.reframeLayoutValue;
  self.layoutPreview.camHeightRatio = self.reframeRatioValue;
  self.layoutPreview.facecamCorner = self.reframeCornerValue;
}

- (void)setReframeLayout:(NSString *)layout camHeightRatio:(double)ratio facecamCorner:(NSString *)corner {
  self.reframeLayoutValue = [layout isEqualToString:@"split"] ? @"split" : @"blur";
  self.reframeRatioValue = MAX(0.20, MIN(0.50, round(ratio * 100) / 100));
  self.reframeCornerValue = [HDCornerNames() containsObject:corner] ? corner : @"bottom-left";
  [self syncReframeControls];
}

- (void)pushReframeChange {
  if (![self.target respondsToSelector:@selector(reframeSettingsChanged:)]) return;
  [self.target performSelector:@selector(reframeSettingsChanged:) withObject:@{
    @"layout": self.reframeLayoutValue ?: @"blur",
    @"camHeightRatio": @(self.reframeRatioValue),
    @"facecamCorner": self.reframeCornerValue ?: @"bottom-left"
  }];
}

- (void)reframeLayoutChanged:(NSSegmentedControl *)sender {
  self.reframeLayoutValue = sender.selectedSegment == 1 ? @"split" : @"blur";
  [self syncReframeControls];
  [self pushReframeChange];
}

- (void)reframeCornerChanged:(NSSegmentedControl *)sender {
  NSInteger segment = sender.selectedSegment;
  if (segment < 0) return;
  self.reframeCornerValue = HDCornerNames()[(sender == self.cornerTopControl ? 0 : 2) + segment];
  [self syncReframeControls];
  [self pushReframeChange];
}

- (void)reframeRatioChanged:(NSSlider *)sender {
  self.reframeRatioValue = MAX(0.20, MIN(0.50, round(sender.doubleValue * 100) / 100));
  self.layoutPreview.camHeightRatio = self.reframeRatioValue;
  self.camRatioValue.stringValue = [NSString stringWithFormat:@"%.0f%%", self.reframeRatioValue * 100];
  self.camRatioSlider.accessibilityValueDescription = self.camRatioValue.stringValue;
  // Preview follows the drag; the config is written once the drag ends.
  NSEventType type = NSApp.currentEvent.type;
  if (type == NSEventTypeLeftMouseDown || type == NSEventTypeLeftMouseDragged) return;
  [self pushReframeChange];
}

- (void)storageCardClicked:(NSButton *)sender {
  [self.storageModePopup selectItemAtIndex:sender.tag];
  [self syncStorageCards];
  if ([self.target respondsToSelector:@selector(storageModeChanged:)]) {
    [self.target performSelector:@selector(storageModeChanged:) withObject:sender];
  }
}

- (void)syncStorageCards {
  NSInteger index = self.storageModePopup.indexOfSelectedItem;
  for (NSButton *button in self.storageCardButtons) {
    HDCardView *card = (HDCardView *)button.superview;
    card.destinationSelected = button.tag == index;
    [card updateLayerColors];
  }
  for (NSInteger i = 0; i < self.storageSelectionBadges.count; i++) {
    self.storageSelectionBadges[i].hidden = i != index;
  }
}

- (void)buildLicensePage {
  NSView *page; NSStackView *stack = [self formPage:&page compact:YES]; self.licensePage = page;
  [stack addArrangedSubview:[self titleRowWithRole:HDSymbolRoleLicense title:@"License"]];
  [stack addArrangedSubview:HDLabel(@"Your trial, license, and activation.", 13, NSFontWeightRegular, NSColor.secondaryLabelColor)];
  HDCardView *card = [self card];
  [stack addArrangedSubview:card];
  [card.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSStackView *box = [[NSStackView alloc] init];
  box.orientation = NSUserInterfaceLayoutOrientationVertical;
  box.alignment = NSLayoutAttributeLeading;
  box.spacing = 8;
  box.translatesAutoresizingMaskIntoConstraints = NO;
  [card addSubview:box];
  [NSLayoutConstraint activateConstraints:@[
    [box.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:20],
    [box.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-20],
    [box.topAnchor constraintEqualToAnchor:card.topAnchor constant:18],
    [box.bottomAnchor constraintEqualToAnchor:card.bottomAnchor constant:-18]
  ]];
  NSStackView *statusRow = [[NSStackView alloc] init];
  statusRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  statusRow.alignment = NSLayoutAttributeCenterY;
  statusRow.spacing = 10;
  self.licenseStatusIcon = HDSymbolImageView(HDSymbolRoleLicenseTrial, 22, NSColor.secondaryLabelColor, @"License status");
  [statusRow addArrangedSubview:self.licenseStatusIcon];
  NSStackView *statusText = [[NSStackView alloc] init];
  statusText.orientation = NSUserInterfaceLayoutOrientationVertical;
  statusText.alignment = NSLayoutAttributeLeading;
  statusText.spacing = 2;
  self.licenseTrialLabel = HDLabel(@"", 12, NSFontWeightRegular, NSColor.secondaryLabelColor);
  [statusText addArrangedSubview:self.licenseTrialLabel];
  self.licenseStatusLabel = HDLabel(@"", 15, NSFontWeightSemibold, NSColor.labelColor);
  [statusText addArrangedSubview:self.licenseStatusLabel];
  [statusRow addArrangedSubview:statusText];
  [box addArrangedSubview:statusRow];
  NSStackView *row = [[NSStackView alloc] init];
  row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  row.spacing = 10;
  self.licenseKeyField = [NSTextField textFieldWithString:@""];
  self.licenseKeyField.placeholderString = @"Paste your license key";
  self.licenseKeyField.translatesAutoresizingMaskIntoConstraints = NO;
  [self.licenseKeyField.widthAnchor constraintGreaterThanOrEqualToConstant:300].active = YES;
  [row addArrangedSubview:self.licenseKeyField];
  self.licenseActivateButton = HDButtonWithSymbol(@"Activate", self.target, @selector(activateLicense:), YES, HDSymbolRoleActivate);
  [self.licenseActivateButton.widthAnchor constraintEqualToConstant:96].active = YES;
  [self.licenseActivateButton.heightAnchor constraintEqualToConstant:30].active = YES;
  [row addArrangedSubview:self.licenseActivateButton];
  NSStackView *entry = [NSStackView new];
  entry.orientation = NSUserInterfaceLayoutOrientationVertical;
  entry.alignment = NSLayoutAttributeLeading;
  entry.spacing = 6;
  [entry addArrangedSubview:row];
  [entry addArrangedSubview:HDLabel(@"The license key arrives by email. Paste it here.", 12, NSFontWeightRegular, NSColor.secondaryLabelColor)];
  self.licenseEntry = entry;
  [box addArrangedSubview:entry];
  NSStackView *actions = [[NSStackView alloc] init];
  actions.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  actions.spacing = 8;
  self.licenseCheckButton = HDButtonWithSymbol(@"Check now", self.target, @selector(checkLicense:), NO, HDSymbolRoleCheck);
  self.licenseDeactivateButton = HDButtonWithSymbol(@"Remove from this Mac", self.target, @selector(deactivateLicense:), NO, HDSymbolRoleDeactivate);
  self.licenseBuyButton = HDButtonWithSymbol(@"Buy a license", self.target, @selector(buyLicense:), NO, HDSymbolRoleBuy);
  [actions addArrangedSubview:self.licenseCheckButton];
  [actions addArrangedSubview:self.licenseDeactivateButton];
  [actions addArrangedSubview:self.licenseBuyButton];
  self.licenseActions = actions;
  [box addArrangedSubview:actions];
  self.licenseTerms = HDLabel(@"After the 7-day trial, a new capture does not start until a license is activated. A license works on up to two computers. An internet connection is needed for validation every 14 days.", 11, NSFontWeightRegular, NSColor.secondaryLabelColor);
  [box addArrangedSubview:self.licenseTerms];
  [self.licenseTerms.widthAnchor constraintEqualToAnchor:box.widthAnchor].active = YES;
}

- (void)buildSettingsPage {
  NSView *page; NSStackView *stack = [self formPage:&page compact:YES]; self.settingsPage = page;
  [stack addArrangedSubview:[self titleRowWithRole:HDSymbolRoleSettings title:@"Settings"]];
  [stack addArrangedSubview:HDLabel(@"Preferences and support.", 13, NSFontWeightRegular, NSColor.secondaryLabelColor)];
  HDCardView *general = [self card]; [stack addArrangedSubview:general];
  [general.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSStackView *box = [self insetStack:general];
  [box addArrangedSubview:HDLabel(@"General", 14, NSFontWeightSemibold, NSColor.labelColor)];
  self.loginCheckbox = [NSButton checkboxWithTitle:@"Launch at login" target:self.target action:@selector(toggleLaunchAtLogin:)];
  self.notificationsCheckbox = [NSButton checkboxWithTitle:@"Notify when clips finish" target:self.target action:@selector(toggleNotifications:)];
  [box addArrangedSubview:self.loginCheckbox]; [box addArrangedSubview:self.notificationsCheckbox];
  [box addArrangedSubview:HDButton(@"Storage Settings…", self.target, @selector(showStorageSettings:), NO)];
  [box addArrangedSubview:HDButton(@"License…", self.target, @selector(showLicense:), NO)];
  HDCardView *support = [self card];
  [stack addArrangedSubview:support];
  [support.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSStackView *supportBox = [self insetStack:support];
  [supportBox addArrangedSubview:HDLabel(@"Support", 14, NSFontWeightSemibold, NSColor.labelColor)];
  NSStackView *supportActions = [NSStackView new]; supportActions.spacing = 8;
  [supportActions addArrangedSubview:HDButtonWithSymbol(@"Check for Updates…", self.target, @selector(checkForUpdates:), NO, HDSymbolRoleSettingsUpdates)];
  [supportActions addArrangedSubview:HDButtonWithSymbol(@"Export Diagnostics…", self.target, @selector(exportDiagnostics:), NO, HDSymbolRoleSettingsDiagnostics)];
  [supportBox addArrangedSubview:supportActions];
  NSTextField *supportNote = HDCaption(@"Export a diagnostic report when you need help with a capture or upload.");
  [supportBox addArrangedSubview:supportNote];
  [supportNote.widthAnchor constraintEqualToAnchor:supportBox.widthAnchor].active = YES;
  [stack addArrangedSubview:HDCaption(@"⌘1 Capture   ·   ⌘2 Clips   ·   ⌘3 Storage   ·   ⌘S Save highlight now")];
  NSButton *advanced = [NSButton checkboxWithTitle:@"Show advanced options" target:self action:@selector(advancedChanged:)];
  [stack addArrangedSubview:advanced];
  self.advancedOptions = [NSStackView new]; self.advancedOptions.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.advancedOptions.alignment = NSLayoutAttributeLeading; self.advancedOptions.spacing = 8;
  [self.advancedOptions addArrangedSubview:HDButton(@"Open Configuration File", self.target, @selector(openConfig:), NO)];
  [self.advancedOptions addArrangedSubview:HDButton(@"Open App Data Folder", self.target, @selector(openStateFolder:), NO)];
  [self.advancedOptions addArrangedSubview:HDButton(@"Open Web Dashboard", self.target, @selector(site:), NO)];
  [stack addArrangedSubview:self.advancedOptions]; self.advancedOptions.hidden = YES;
  [stack addArrangedSubview:HDCaption([NSString stringWithFormat:@"ClipSpike %@", NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"] ?: @"3.0.0"])];
}

- (void)advancedChanged:(NSButton *)sender { self.advancedOptions.hidden = sender.state != NSControlStateValueOn; }

- (void)storageAdvancedChanged:(NSButton *)sender { self.storageAdvancedOptions.hidden = sender.state != NSControlStateValueOn; }

- (void)setLocalOutputPath:(NSString *)path {
  self.localOutputPathLabel.stringValue = path.stringByAbbreviatingWithTildeInPath;
  self.localOutputPathLabel.toolTip = path;
}

- (void)setLibraryEmpty:(BOOL)empty {
  self.libraryEmptyView.hidden = !empty;
  self.libraryScroll.hidden = empty;
  BOOL filtered = self.clipSearchField.stringValue.length || self.clipFilterControl.selectedSegment != 0;
  self.libraryEmptyTitle.stringValue = filtered ? @"No matching clips" : @"Your highlights start here";
  self.libraryEmptyBody.stringValue = filtered ? @"Try another search or show all clips in your library." : @"Capture a live stream or find moments in a past broadcast.";
  self.libraryEmptyAction.title = filtered ? @"Clear Search & Filters" : @"Go to Capture";
}

- (void)libraryEmptyClicked:(id)sender {
  if (self.clipSearchField.stringValue.length || self.clipFilterControl.selectedSegment != 0) {
    self.clipSearchField.stringValue = @"";
    self.clipFilterControl.selectedSegment = 0;
    if ([self.target respondsToSelector:@selector(reloadHistoryFromDisk)])
      [self.target performSelector:@selector(reloadHistoryFromDisk)];
  } else [self selectPage:HDPageCapture];
}

- (void)syncStorageVisibility {
  BOOL local = self.storageModePopup.indexOfSelectedItem == 0;
  self.storageFolderRow.hidden = local;
  self.storageKeepLocalCheckbox.hidden = local;
  self.storageDeleteCheckbox.hidden = YES;
  self.localOutputBox.hidden = !local;
}


- (void)updateSummaryWithClips:(NSInteger)clips queue:(NSInteger)queue storage:(NSString *)storage trial:(NSInteger)trial {
  self.summaryBase = [NSString stringWithFormat:@"%ld clip%@ this session · %ld pending upload%@ · %@", (long)clips, clips == 1 ? @"" : @"s", (long)queue, queue == 1 ? @"" : @"s", storage.length ? storage : @"This Mac"];
  [self renderSummary];
}

- (void)renderSummary {
  NSString *base = self.summaryBase ?: self.sessionSummary.stringValue;
  self.sessionSummary.stringValue = self.planNoteText.length ? [NSString stringWithFormat:@"%@ · %@", base, self.planNoteText] : base;
}

- (void)setPlanNote:(NSString *)note {
  self.planNoteText = note;
  [self renderSummary];
}

- (void)setSessionLive:(BOOL)live status:(NSString *)status {
  [self setSessionState:live ? HDSessionStateLive : HDSessionStateReady status:status];
}

- (void)setSessionState:(HDSessionState)state status:(NSString *)status {
  HDSymbolRole role = HDSymbolRoleStatusReady;
  NSColor *color = NSColor.secondaryLabelColor;
  NSString *label = @"Idle";
  NSString *heroTitle = self.channelField.stringValue.length ? [NSString stringWithFormat:@"Ready to capture %@", self.channelField.stringValue] : @"Enter a channel to begin";
  NSString *heroSubtitle = @"Start capture and keep ClipSpike running while the stream is live.";
  switch (state) {
    case HDSessionStateLive:
      role = HDSymbolRoleStatusLive; color = HDLive(); label = @"Capturing";
      heroTitle = @"Capturing highlights";
      heroSubtitle = status.length ? status : @"Chat connected. Highlights are being captured.";
      break;
    case HDSessionStateReconnecting:
      role = HDSymbolRoleStatusReconnecting; color = HDWarn(); label = @"Reconnecting";
      heroTitle = @"Reconnecting to chat…";
      heroSubtitle = status.length ? status : @"The recorder is reconnecting to the stream.";
      break;
    case HDSessionStateStopping:
      role = HDSymbolRoleStatusStopping; color = NSColor.secondaryLabelColor; label = @"Stopping";
      heroTitle = @"Stopping capture…";
      heroSubtitle = status.length ? status : @"Finishing the current clip and closing the recorder.";
      break;
    case HDSessionStateError:
      role = HDSymbolRoleStatusError; color = HDWarn(); label = @"Needs attention";
      heroTitle = @"Capture interrupted.";
      heroSubtitle = status.length ? status : @"Check the recorder status and try again.";
      break;
    case HDSessionStateReady:
    default:
      break;
  }
  if (self.vodMode && !self.liveRunning) {
    if (state == HDSessionStateReady) {
      heroTitle = self.vodRunning ? @"Finding highlights" : @"Find highlights in a VOD";
      heroSubtitle = status.length ? status : @"Paste a past broadcast link. ClipSpike reads the chat replay and saves the moments chat reacted to.";
    } else if (state == HDSessionStateLive) {
      label = @"Scanning VOD";
      heroTitle = @"Finding highlights";
    } else if (state == HDSessionStateStopping) {
      label = @"Cancelling";
      heroTitle = @"Cancelling…";
    } else if (state == HDSessionStateError) {
      heroTitle = @"VOD scan stopped.";
    }
  }
  self.sidebarStatusText.stringValue = label;
  self.sidebarStatusText.textColor = state == HDSessionStateLive ? HDLive() : HDText();
  self.sidebarStatusIcon.image = HDSymbolImage(role, 11, NSFontWeightSemibold, @"Session status");
  self.sidebarStatusIcon.contentTintColor = color;
  [self setLiveIndicatorPulsing:state == HDSessionStateLive];
  self.captureHeroTitle.stringValue = heroTitle;
  self.captureHeroSubtitle.stringValue = heroSubtitle;
  self.statusLabel.hidden = !self.statusLabel.stringValue.length || [self.statusLabel.stringValue isEqualToString:heroSubtitle];
}

// Gentle breathing on the sidebar live dot; skipped when the user prefers reduced motion.
- (void)setLiveIndicatorPulsing:(BOOL)pulsing {
  self.sidebarStatusIcon.wantsLayer = YES;
  CALayer *layer = self.sidebarStatusIcon.layer;
  BOOL animate = pulsing && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  if (animate) {
    if ([layer animationForKey:@"hdPulse"]) return;
    CABasicAnimation *pulse = [CABasicAnimation animationWithKeyPath:@"opacity"];
    pulse.fromValue = @1.0; pulse.toValue = @0.35;
    pulse.duration = 1.1; pulse.autoreverses = YES; pulse.repeatCount = HUGE_VALF;
    pulse.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    [layer addAnimation:pulse forKey:@"hdPulse"];
  } else {
    [layer removeAnimationForKey:@"hdPulse"];
    layer.opacity = 1;
  }
}

- (void)recordChatSample:(NSDictionary *)event {
  NSMutableDictionary *sample = [NSMutableDictionary dictionary];
  for (NSString *key in @[@"participants", @"threshold", @"median", @"reactions"]) {
    sample[key] = [event[key] isKindOfClass:NSNumber.class] ? event[key] : @0;
  }
  sample[@"trigger"] = @([event[@"trigger"] boolValue]);
  if ([event[@"at"] isKindOfClass:NSDate.class]) sample[@"at"] = event[@"at"];
  sample[@"topEmotes"] = [event[@"topEmotes"] isKindOfClass:NSArray.class] ? event[@"topEmotes"] : @[];
  [self.chatPulse addSample:sample];
}

- (void)recordChatTrigger:(NSDictionary *)info { [self.chatPulse noteTrigger:info]; }
- (void)resetChatPulse { [self.chatPulse reset]; }

- (void)setCaptureRunning:(BOOL)running {
  self.liveRunning = running;
  [self.chatPulse reset];
  self.vodButton.enabled = !running;
  self.vodButton.toolTip = running ? @"Stop the live capture first." : nil;
  self.channelField.enabled = !running;
  self.toggleButton.image = HDSymbolImage(running ? HDSymbolRoleStop : HDSymbolRoleRecord, 13, NSFontWeightSemibold, running ? @"Stop capture" : @"Start capture");
  self.toggleButton.imagePosition = NSImageLeading;
  self.toggleButton.imageHugsTitle = YES;
}

- (void)setLicenseState:(HDLicenseState)state {
  BOOL disabled = state == HDLicenseStateDisabled;
  BOOL active = state == HDLicenseStateValid;
  self.licenseEntry.hidden = disabled || active;
  self.licenseActions.hidden = disabled;
  self.licenseTerms.hidden = disabled;
  self.licenseBuyButton.hidden = disabled || active;
  self.licenseCheckButton.hidden = !active && !self.licenseCheckButton.enabled;
  self.licenseDeactivateButton.hidden = !active && !self.licenseDeactivateButton.enabled;
  HDSymbolRole role = HDSymbolRoleLicenseTrial;
  NSColor *color = NSColor.secondaryLabelColor;
  switch (state) {
    case HDLicenseStateValid: role = HDSymbolRoleLicenseValid; color = HDGood(); break;
    case HDLicenseStateExpired: role = HDSymbolRoleLicenseExpired; color = HDWarn(); break;
    case HDLicenseStateDisabled: role = HDSymbolRoleLicenseDisabled; color = HDMuted(); break;
    case HDLicenseStateTrial: role = HDSymbolRoleLicenseTrial; color = HDWarn(); break;
  }
  self.licenseStatusIcon.image = HDSymbolImage(role, 22, NSFontWeightSemibold, @"License status");
  self.licenseStatusIcon.contentTintColor = color;
}

- (void)setLicenseEntryVisible:(BOOL)visible {
  self.licenseEntry.hidden = !visible;
}

- (void)setCaptureOfferText:(NSString *)text buyTitle:(NSString *)buyTitle showBuy:(BOOL)showBuy showKey:(BOOL)showKey {
  BOOL show = text.length > 0;
  self.offerCard.hidden = !show;
  self.offerLabel.stringValue = text ?: @"";
  if (buyTitle.length) self.offerBuyButton.title = buyTitle;
  self.offerBuyButton.hidden = !showBuy;
  self.offerKeyButton.hidden = !showKey;
}

- (void)setAccountLine:(NSString *)line {
  self.sidebarAccountText.stringValue = line ?: @"";
  self.sidebarAccountText.hidden = !line.length;
}

- (void)presentOnboarding {
  if (self.onboardingWindow) return;
  NSWindow *sheet = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,520,370) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  sheet.title = @"Set Up Capture";
  sheet.contentView.wantsLayer = YES;
  [sheet.effectiveAppearance performAsCurrentDrawingAppearance:^{ sheet.contentView.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor; }];
  NSStackView *stack = [self insetStack:sheet.contentView]; stack.spacing = 14;
  [stack addArrangedSubview:HDLabel(@"Your first highlight", 22, NSFontWeightSemibold, NSColor.labelColor)];
  [stack addArrangedSubview:HDLabel(@"Choose a channel and save location to get started.", 13, NSFontWeightRegular, NSColor.secondaryLabelColor)];
  [stack addArrangedSubview:HDLabel(@"Twitch channel", 12, NSFontWeightMedium, NSColor.labelColor)];
  self.onboardingChannel = [NSTextField textFieldWithString:self.channelField.stringValue ?: @""];
  self.onboardingChannel.placeholderString = @"Enter a username";
  [stack addArrangedSubview:self.onboardingChannel];
  [self.onboardingChannel.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [self.onboardingChannel.heightAnchor constraintEqualToConstant:28].active = YES;
  self.onboardingStoragePopup = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
  [self.onboardingStoragePopup addItemsWithTitles:@[@"This Mac", @"Dropbox", @"Google Drive"]];
  [self.onboardingStoragePopup selectItemAtIndex:self.storageModePopup.indexOfSelectedItem];
  self.onboardingStoragePopup.target = self; self.onboardingStoragePopup.action = @selector(onboardingDestinationChanged:);
  NSStackView *destination = [NSStackView new]; destination.spacing = 12;
  [destination addArrangedSubview:HDLabel(@"Save clips to", 12, NSFontWeightMedium, NSColor.labelColor)];
  [destination addArrangedSubview:self.onboardingStoragePopup]; [stack addArrangedSubview:destination];
  self.onboardingStorageNote = HDCaption(@"");
  [stack addArrangedSubview:self.onboardingStorageNote];
  [self.onboardingStorageNote.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [self onboardingDestinationChanged:nil];
  self.onboardingPermission = [NSButton checkboxWithTitle:@"I have permission to record this channel." target:self action:@selector(onboardingInputChanged:)];
  [stack addArrangedSubview:self.onboardingPermission];
  NSStackView *actions = [NSStackView new]; actions.spacing = 8;
  NSButton *later = HDButton(@"Set Up Later", self.target, @selector(onboardingSkip:), NO);
  self.onboardingContinue = HDButton(@"Start capture", self.target, @selector(onboardingStart:), YES);
  self.onboardingContinue.keyEquivalent = @"\r";
  [actions addArrangedSubview:later]; [actions addArrangedSubview:self.onboardingContinue]; [stack addArrangedSubview:actions];
  [stack addArrangedSubview:HDCaption(@"Keep the app running while the stream is live. Output is vertical (9:16).")];
  self.onboardingWindow = sheet;
  [self onboardingDestinationChanged:nil];
  [self onboardingInputChanged:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(onboardingInputChanged:) name:NSControlTextDidChangeNotification object:self.onboardingChannel];
  [self.window beginSheet:sheet completionHandler:nil];
  [sheet makeFirstResponder:nil];
}

- (void)onboardingDestinationChanged:(id)sender {
  BOOL local = self.onboardingStoragePopup.indexOfSelectedItem == 0;
  self.onboardingStorageNote.stringValue = local ? @"Clips are saved on this Mac. You can change the folder in Storage." : @"Connect this account in Storage before starting cloud capture.";
  if (self.onboardingContinue) self.onboardingContinue.title = local ? @"Start capture" : @"Continue to Storage";
}

- (void)onboardingInputChanged:(id)sender {
  NSString *name = [self.onboardingChannel.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  self.onboardingContinue.enabled = self.onboardingPermission.state == NSControlStateValueOn && [[NSPredicate predicateWithFormat:@"SELF MATCHES %@", @"[A-Za-z0-9_]{1,25}"] evaluateWithObject:name];
}


- (void)dismissOnboarding {
  if (!self.onboardingWindow) return;
  [[NSNotificationCenter defaultCenter] removeObserver:self name:NSControlTextDidChangeNotification object:self.onboardingChannel];
  [self.window endSheet:self.onboardingWindow];
  self.onboardingWindow = nil;
}

@end
