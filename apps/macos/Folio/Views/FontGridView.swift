import AppKit
import SwiftUI

struct FontGridView: View {
    @Bindable var model: LibraryViewModel

    private var presentation: FontCardPresentation {
        if model.isSelectingInstalledForCloud, model.viewMode == .stack { return .strip }
        return switch model.viewMode {
        case .compactGrid: .compact
        case .largeGrid: .large
        case .list: .strip
        case .stack: .expanded
        }
    }

    var body: some View {
        content
            .id(presentation)
            .transition(.opacity)
            .animation(.easeInOut(duration: 0.18), value: presentation)
    }

    @ViewBuilder
    private var content: some View {
        if presentation == .expanded {
            ExpandedFontCardCarousel(model: model)
        } else {
            Group {
                if presentation == .strip {
                    LazyVStack(spacing: 12) {
                        cards
                    }
                } else {
                    LazyVGrid(
                        columns: [GridItem(
                            .adaptive(
                                minimum: presentation.width
                            ),
                            spacing: 12
                        )],
                        alignment: .leading,
                        spacing: 12
                    ) {
                        cards
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: LibraryLayout.cardContainerMaxWidth)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var cards: some View {
        ForEach(model.families) { family in
            FontFamilyCardView(
                model: model,
                family: family,
                presentation: presentation
            )
            .frame(maxWidth: .infinity)
        }
    }
}

private struct ExpandedFontCardCarousel: View {
    @Bindable var model: LibraryViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(AppPreferences.hoverSelectionHaptics) private var hapticsEnabled = true
    @AppStorage(AppPreferences.expandedCardHeightRatio) private var expandedCardHeightRatio = 0.68
    @AppStorage(AppPreferences.expandedCardWheelSpeed) private var wheelSpeed = 1.25
    @State private var scrollProgress: CGFloat = 0
    @State private var lastScrollDirection: CGFloat = 0
    @State private var pendingIndex: Int?
    @State private var pendingMoveTask: Task<Void, Never>?
    @State private var pendingAnimationTask: Task<Void, Never>?
    @State private var previousPageTask: Task<Void, Never>?
    @State private var viewportWidth: CGFloat = 820
    @State private var draftHeightRatio: CGFloat?
    @State private var dragStartHeightRatio: CGFloat?
    @State private var resizingCardIndex: Int?

    private var pagerWidth: CGFloat {
        min(cardWidth, 520)
    }

    private var cardWidth: CGFloat {
        let preferredWidth = min(max(viewportWidth * 0.36 + 158, 280), 960)
        return min(preferredWidth, max(viewportWidth - 24, 1))
    }

    private var cardHeight: CGFloat {
        cardWidth * CGFloat(expandedCardHeightRatio)
    }

    private var activeCardHeight: CGFloat {
        cardWidth * (draftHeightRatio ?? CGFloat(expandedCardHeightRatio))
    }

    private var stageHeight: CGFloat {
        max(cardHeight, activeCardHeight)
    }

    private var cardScale: CGFloat {
        cardWidth / FontCardPresentation.expanded.width
    }

    private var stackWidth: CGFloat {
        518 * cardScale
    }

    private var currentIndex: Int {
        logicalIndex(for: Int(scrollProgress.rounded()))
    }

    private var currentVirtualIndex: Int {
        Int(scrollProgress.rounded())
    }

    private var displayedIndex: Int {
        pendingIndex ?? currentIndex
    }

    private var totalCount: Int {
        max(model.families.count, Int(clamping: model.totalMatches))
    }

    private var cycleLength: Int {
        totalCount + 1
    }

    private var hasCompleteCycle: Bool {
        totalCount > 1
            && model.families.count + model.carouselTailFamilies.count >= totalCount
    }

    private var minimumVirtualIndex: Int {
        if hasCompleteCycle { return -cycleLength }
        guard !model.carouselTailFamilies.isEmpty else { return 0 }
        return -(min(model.carouselTailFamilies.count, max(totalCount - 1, 0)) + 1)
    }

    private var maximumVirtualIndex: Int {
        guard totalCount > 1 else { return 0 }
        return model.families.count >= totalCount
            ? cycleLength
            : max(model.families.count - 1, 0)
    }

    private var visibleIndices: [Int] {
        guard !model.families.isEmpty else { return [] }
        let lowerIndex = Int(floor(scrollProgress))
        let fraction = scrollProgress - floor(scrollProgress)
        let lowerBound = fraction < 0.001 ? lowerIndex - 2 : lowerIndex - 1
        let upperBound = fraction < 0.001 ? lowerIndex : lowerIndex + 1
        let validLowerBound = hasCompleteCycle
            ? lowerBound
            : max(lowerBound, minimumVirtualIndex)
        let validUpperBound = min(upperBound, maximumVirtualIndex)
        guard validLowerBound <= validUpperBound else { return [] }
        var indices = Array(validLowerBound...validUpperBound)
        let leadingLastIndex = -2
        let trailingLastIndex = totalCount - 1
        if abs(scrollProgress - CGFloat(leadingLastIndex)) < 1 {
            indices.append(-1)
        }
        if model.families.count >= totalCount,
           abs(scrollProgress - CGFloat(trailingLastIndex)) < 1 {
            indices.append(totalCount)
        }
        return Array(Array(Set(indices)).sorted().suffix(3))
    }

    var body: some View {
        VStack(spacing: 10) {
            GeometryReader { geometry in
                let viewportWidth = geometry.size.width
                ZStack {
                    cardStack(viewportWidth: viewportWidth)
                    HorizontalPagingInput(
                        progress: scrollProgress,
                        lowerBound: CGFloat(minimumVirtualIndex),
                        upperBound: CGFloat(maximumVirtualIndex),
                        hapticsEnabled: hapticsEnabled,
                        wheelSpeed: wheelSpeed,
                        onChange: updateScrollProgress,
                        onEnd: requestVirtualMove
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .onAppear {
                    if viewportWidth > 0 { self.viewportWidth = viewportWidth }
                }
                .onChange(of: viewportWidth) { _, width in
                    if width > 0 { self.viewportWidth = width }
                }
            }
            .frame(height: stageHeight)

            pager
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .onAppear {
            if let selectedFamilyID = model.selectedFamilyID,
               let selectedIndex = virtualIndex(for: selectedFamilyID) {
                scrollProgress = CGFloat(selectedIndex)
            }
        }
        .onChange(of: model.families.map(\.id)) { _, _ in
            clampScrollProgress()
        }
        .onChange(of: model.carouselTailFamilies.map(\.id)) { _, _ in
            clampScrollProgress()
        }
        .onChange(of: totalCount) { _, _ in
            clampScrollProgress()
        }
        .onChange(of: scrollProgress) { _, _ in
            prefetchPreviousPageIfNeeded()
        }
        .onChange(of: model.selectedFamilyID) { _, familyID in
            guard let familyID,
                  let index = virtualIndex(for: familyID),
                  logicalIndex(for: index) != currentIndex else { return }
            animate(to: index)
        }
        .onDisappear {
            pendingMoveTask?.cancel()
            pendingAnimationTask?.cancel()
            previousPageTask?.cancel()
        }
    }

    private func cardStack(viewportWidth: CGFloat) -> some View {
        ZStack(alignment: .topTrailing) {
            ForEach(visibleIndices, id: \.self) { index in
                let depth = scrollProgress - CGFloat(index)
                if isWrapHint(index) {
                    wrapQueueCard(depth: depth)
                        .zIndex(wrapQueueZIndex(for: depth))
                        .allowsHitTesting(false)
                } else if let family = family(at: index) {
                    let isCurrent = abs(depth) < 0.001
                    let height = isCurrent ? activeCardHeight : cardHeight
                    FontFamilyCardView(
                        model: model,
                        family: family,
                        presentation: .expanded,
                        expandedSize: CGSize(width: cardWidth, height: height)
                    )
                    .frame(
                        width: cardWidth,
                        height: height
                    )
                    .overlay(alignment: .bottom) {
                        if isCurrent {
                            Image.englishSystemName("line.3.horizontal")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.tertiary)
                                .padding(.bottom, 2)
                                .allowsHitTesting(false)
                        }
                    }
                    .highPriorityGesture(
                        cardResizeGesture(for: index),
                        including: isCurrent ? .all : .none
                    )
                    .help(isCurrent ? "上下拖动调整卡片高度比例" : "")
                    .accessibilityHint(isCurrent ? "上下拖动调整卡片高度比例" : "")
                    .scaleEffect(cardScale(for: depth))
                    .offset(x: cardOffset(for: depth))
                    .opacity(cardOpacity(for: depth))
                    .blur(radius: cardBlur(for: depth))
                    .zIndex(cardZIndex(for: depth))
                    .allowsHitTesting(index >= 0 || abs(depth) < 0.001)
                }
            }
        }
        .frame(
            width: min(stackWidth, viewportWidth),
            height: stageHeight,
            alignment: .topTrailing
        )
    }

    private func cardResizeGesture(for index: Int) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                guard resizingCardIndex == index
                    || (resizingCardIndex == nil && abs(scrollProgress - CGFloat(index)) < 0.001)
                else { return }
                guard abs(value.translation.height) > abs(value.translation.width) else { return }

                let origin = dragStartHeightRatio ?? CGFloat(expandedCardHeightRatio)
                dragStartHeightRatio = origin
                resizingCardIndex = index
                draftHeightRatio = min(max(origin + value.translation.height / cardWidth, 0.45), 1.4)
            }
            .onEnded { _ in
                guard resizingCardIndex == index, let ratio = draftHeightRatio else { return }
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.24)) {
                    expandedCardHeightRatio = Double(ratio)
                    draftHeightRatio = nil
                    dragStartHeightRatio = nil
                    resizingCardIndex = nil
                }
            }
    }

    private func wrapQueueCard(depth: CGFloat) -> some View {
        Image.englishSystemName("arrowshape.turn.up.backward.2.fill")
            .font(.system(size: 34, weight: .medium))
            .foregroundStyle(.secondary)
            .environment(\.layoutDirection, .rightToLeft)
            .frame(width: cardWidth / 2, height: cardHeight)
            .offset(x: wrapQueueOffset(for: depth))
            .opacity(wrapQueueOpacity(for: depth))
            .blur(radius: depth > 0 ? min(depth, 2) : 0)
    }

    private func family(at index: Int) -> FamilyCard? {
        guard totalCount > 0, !isWrapHint(index) else { return nil }
        let logicalIndex = logicalIndex(for: index)
        if model.families.indices.contains(logicalIndex) {
            return model.families[logicalIndex]
        }
        let tailStartIndex = totalCount - model.carouselTailFamilies.count
        let tailIndex = logicalIndex - tailStartIndex
        guard model.carouselTailFamilies.indices.contains(tailIndex) else { return nil }
        return model.carouselTailFamilies[tailIndex]
    }

    private func logicalIndex(for virtualIndex: Int) -> Int {
        guard totalCount > 0 else { return 0 }
        let queueIndex = queueIndex(for: virtualIndex)
        return queueIndex == totalCount ? totalCount - 1 : queueIndex
    }

    private func queueIndex(for virtualIndex: Int) -> Int {
        guard cycleLength > 0 else { return 0 }
        let remainder = virtualIndex % cycleLength
        return remainder >= 0 ? remainder : remainder + cycleLength
    }

    private func isWrapHint(_ virtualIndex: Int) -> Bool {
        totalCount > 1 && queueIndex(for: virtualIndex) == totalCount
    }

    private func virtualIndex(for familyID: FamilyID) -> Int? {
        if let index = model.families.firstIndex(where: { $0.id == familyID }) {
            return index
        }
        guard let tailIndex = model.carouselTailFamilies.firstIndex(where: {
            $0.id == familyID
        }) else { return nil }
        return tailIndex - model.carouselTailFamilies.count - 1
    }

    private var pager: some View {
        VStack(spacing: 0) {
            HStack {
                pageButton(systemName: "chevron.left", offset: -1, label: "上一个字体")
                Spacer()
                Text(totalCount == 0 ? "0" : "\(displayedIndex + 1)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
                Spacer()
                pageButton(systemName: "chevron.right", offset: 1, label: "下一个字体")
            }
            .frame(height: 22)

            Slider(
                value: Binding(
                    get: { Double(totalCount == 0 ? 0 : displayedIndex + 1) },
                    set: { requestMove(to: Int($0.rounded()) - 1, animated: false) }
                ),
                in: totalCount > 1 ? 1...Double(totalCount) : 0...1,
                step: 1
            )
            .disabled(totalCount < 2)
            .accessibilityLabel("字体位置")
            .accessibilityValue(
                totalCount == 0
                    ? "没有字体"
                    : "第 \(displayedIndex + 1) 个，共 \(totalCount) 个"
            )

            HStack {
                Text(totalCount == 0 ? "0" : "1")
                Spacer()
                Text("\(totalCount)")
            }
            .font(.caption2.monospaced())
            .foregroundStyle(.tertiary)
            .padding(.horizontal, 4)
            .frame(height: 15)
        }
        .frame(maxWidth: pagerWidth)
        .padding(.horizontal, 10)
    }

    private var pageAnimation: Animation? {
        reduceMotion ? nil : .snappy(duration: 0.38, extraBounce: 0.06)
    }

    private func pageButton(
        systemName: String,
        offset: Int,
        label: String
    ) -> some View {
        Button {
            requestVirtualMove(to: currentVirtualIndex + offset)
        } label: {
            Image.englishSystemName(systemName)
                .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .disabled(
            totalCount < 2
                || currentVirtualIndex + offset < -cycleLength
        )
        .accessibilityLabel(label)
    }

    private func requestMove(to index: Int, animated: Bool = true) {
        guard totalCount > 0 else { return }
        let targetIndex = min(max(index, 0), totalCount - 1)
        pendingMoveTask?.cancel()
        pendingAnimationTask?.cancel()
        pendingIndex = targetIndex

        let tailStartIndex = totalCount - model.carouselTailFamilies.count
        if targetIndex >= tailStartIndex {
            let tailIndex = targetIndex - tailStartIndex
            if model.carouselTailFamilies.indices.contains(tailIndex) {
                pendingIndex = nil
                move(to: tailIndex - model.carouselTailFamilies.count - 1, animated: animated)
                return
            }
        }
        if model.families.indices.contains(targetIndex) {
            pendingIndex = nil
            move(to: targetIndex, animated: animated)
            return
        }

        pendingMoveTask = Task { @MainActor in
            await model.loadFamilies(through: targetIndex)
            guard !Task.isCancelled, pendingIndex == targetIndex else { return }
            guard model.families.indices.contains(targetIndex) else {
                pendingIndex = nil
                return
            }
            pendingIndex = nil
            move(to: targetIndex, animated: animated)
        }
    }

    private func move(to index: Int, animated: Bool) {
        if animated {
            animate(to: index)
            return
        }
        pendingAnimationTask?.cancel()
        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) {
            scrollProgress = CGFloat(index)
            selectFamily(at: index)
        }
    }

    private func requestVirtualMove(to index: Int) {
        guard totalCount > 0, index >= -cycleLength else { return }
        if index < minimumVirtualIndex {
            pendingMoveTask?.cancel()
            pendingMoveTask = Task { @MainActor in
                await model.loadPreviousCarouselPage()
                guard !Task.isCancelled,
                      index >= minimumVirtualIndex else { return }
                requestVirtualMove(to: index)
            }
            return
        }
        if index > maximumVirtualIndex {
            guard model.families.count < totalCount else { return }
            requestMove(to: logicalIndex(for: index))
            return
        }
        if isWrapHint(index) {
            let target = wrapDestination(from: index)
            animateAcrossWrap(to: target)
            return
        }
        if family(at: index) != nil {
            pendingMoveTask?.cancel()
            pendingIndex = nil
            animate(to: index)
            return
        }
        if index < 0 {
            pendingMoveTask?.cancel()
            pendingMoveTask = Task { @MainActor in
                await model.loadPreviousCarouselPage()
                guard !Task.isCancelled, family(at: index) != nil else { return }
                requestVirtualMove(to: index)
            }
            return
        }
        requestMove(to: logicalIndex(for: index))
    }

    private func prefetchPreviousPageIfNeeded() {
        guard totalCount > 1,
              !hasCompleteCycle,
              !model.carouselTailFamilies.isEmpty,
              scrollProgress <= CGFloat(minimumVirtualIndex + 1),
              previousPageTask == nil else { return }
        previousPageTask = Task { @MainActor in
            await model.loadPreviousCarouselPage()
            previousPageTask = nil
        }
    }

    private func clampScrollProgress() {
        guard !model.families.isEmpty else {
            scrollProgress = 0
            return
        }
        scrollProgress = min(
            max(scrollProgress, CGFloat(minimumVirtualIndex)),
            CGFloat(maximumVirtualIndex)
        )
    }

    private func updateScrollProgress(_ progress: CGFloat) {
        guard !model.families.isEmpty else { return }
        pendingMoveTask?.cancel()
        pendingAnimationTask?.cancel()
        pendingIndex = nil
        let nextProgress = min(
            max(progress, CGFloat(minimumVirtualIndex)),
            CGFloat(maximumVirtualIndex)
        )
        let delta = nextProgress - scrollProgress
        if abs(delta) > 0.001 {
            lastScrollDirection = delta
        }
        scrollProgress = nextProgress
        if scrollProgress >= 0,
           scrollProgress >= CGFloat(model.families.count - 4) {
            Task {
                await model.loadFamilies(through: model.families.count + 3)
            }
        }
    }

    private func wrapDestination(from hintIndex: Int) -> Int {
        let distance = CGFloat(hintIndex) - scrollProgress
        if abs(distance) > 0.001 {
            return hintIndex + (distance > 0 ? 1 : -1)
        }
        return hintIndex + (lastScrollDirection >= 0 ? 1 : -1)
    }

    private func animateAcrossWrap(to index: Int) {
        guard family(at: index) != nil else { return }
        pendingMoveTask?.cancel()
        pendingAnimationTask?.cancel()
        pendingIndex = nil
        let target = CGFloat(index)
        if reduceMotion {
            scrollProgress = target
            selectFamily(at: index)
            normalizeWrappedProgress(after: index)
            return
        }
        let distance = abs(target - scrollProgress)
        let duration = min(max(0.34 + Double(distance) * 0.14, 0.42), 0.64)
        withAnimation(.snappy(duration: duration, extraBounce: 0.03)) {
            scrollProgress = target
        }
        selectFamily(at: index)
        normalizeWrappedProgress(after: index)
    }

    private func animate(to index: Int) {
        guard isWrapHint(index) || family(at: index) != nil else { return }
        pendingAnimationTask?.cancel()
        let target = CGFloat(index)
        if reduceMotion {
            scrollProgress = target
            selectFamily(at: index)
            normalizeWrappedProgress(after: index)
            return
        }

        let direction: CGFloat = target >= scrollProgress ? 1 : -1
        if abs(target - scrollProgress) > 1 {
            scrollProgress = target - direction * 0.999
        } else if abs(target - scrollProgress) >= 0.001 {
            scrollProgress += direction * 0.001
        }
        pendingAnimationTask = Task { @MainActor in
            await Task.yield()
            guard !Task.isCancelled else { return }
            withAnimation(pageAnimation) {
                scrollProgress = target
            }
            selectFamily(at: index)
            normalizeWrappedProgress(after: index)
        }
    }

    private func selectFamily(at index: Int) {
        guard !isWrapHint(index) else { return }
        guard let family = family(at: index) else { return }
        guard family.id != model.selectedFamilyID else { return }
        model.selectFamily(family)
    }

    private func normalizeWrappedProgress(after index: Int) {
        guard index == cycleLength || index == -cycleLength else { return }
        Task { @MainActor in
            if !reduceMotion {
                try? await Task.sleep(for: .milliseconds(420))
            }
            guard abs(scrollProgress - CGFloat(index)) < 0.001 else { return }
            var transaction = Transaction()
            transaction.animation = nil
            withTransaction(transaction) {
                scrollProgress = 0
            }
        }
    }

    private func wrapQueueOffset(for depth: CGFloat) -> CGFloat {
        if depth <= 0 {
            let transition = 1 - min(-depth, 1)
            return cardWidth / 2 - transition * cardWidth * 3 / 4
        }
        if depth <= 1 {
            let restingOffset = cardOffset(for: 1)
            return -cardWidth / 4 + depth * (restingOffset + cardWidth / 4)
        }
        return cardOffset(for: depth)
    }

    private func wrapQueueOpacity(for depth: CGFloat) -> Double {
        if depth < 0 {
            return Double(1 - min(-depth, 1) * 0.25)
        }
        if depth <= 1 {
            return Double(1 - depth * 0.30)
        }
        return Double(0.70 - min(depth - 1, 1) * 0.40)
    }

    private func wrapQueueZIndex(for depth: CGFloat) -> Double {
        if depth < 0 {
            return Double(1.5 + min(depth + 1, 1))
        }
        return cardZIndex(for: depth) + 0.1
    }

    private func cardScale(for depth: CGFloat) -> CGFloat {
        if depth < 0 {
            return 1 - min(-depth, 1) * 0.08
        }
        if depth <= 1 {
            return 1 - depth * 0.15
        }
        return 0.85 - min(depth - 1, 1) * 0.10
    }

    private func cardOffset(for depth: CGFloat) -> CGFloat {
        if depth < 0 {
            return min(-depth, 1) * 120 * cardScale
        }
        if depth <= 1 {
            return depth * -105.25 * cardScale
        }
        return (-105.25 - min(depth - 1, 1) * 54) * cardScale
    }

    private func cardOpacity(for depth: CGFloat) -> Double {
        if depth < 0 {
            return Double(1 - min(-depth, 1))
        }
        if depth <= 1 {
            return Double(1 - depth * 0.30)
        }
        return Double(0.70 - min(depth - 1, 1) * 0.40)
    }

    private func cardBlur(for depth: CGFloat) -> CGFloat {
        if depth < 0 {
            return min(-depth, 1)
        }
        if depth <= 1 {
            return depth * 1.5
        }
        return 1.5 + min(depth - 1, 1) * 1.5
    }

    private func cardZIndex(for depth: CGFloat) -> Double {
        if depth < 0 {
            return Double(4 + depth)
        }
        return Double(3 - depth)
    }
}

private struct HorizontalPagingInput: NSViewRepresentable {
    let progress: CGFloat
    let lowerBound: CGFloat
    let upperBound: CGFloat
    let hapticsEnabled: Bool
    let wheelSpeed: Double
    let onChange: (CGFloat) -> Void
    let onEnd: (Int) -> Void

    func makeNSView(context: Context) -> HorizontalPagingInputView {
        let view = HorizontalPagingInputView()
        view.onChange = onChange
        view.onEnd = onEnd
        view.hapticsEnabled = hapticsEnabled
        view.wheelSpeed = wheelSpeed
        view.lowerBound = lowerBound
        view.upperBound = upperBound
        return view
    }

    func updateNSView(_ view: HorizontalPagingInputView, context: Context) {
        view.progress = progress
        view.lowerBound = lowerBound
        view.upperBound = upperBound
        view.hapticsEnabled = hapticsEnabled
        view.wheelSpeed = wheelSpeed
        view.onChange = onChange
        view.onEnd = onEnd
    }
}

private final class HorizontalPagingInputView: NSView {
    var progress: CGFloat = 0
    var lowerBound: CGFloat = 0
    var upperBound: CGFloat = 0
    var hapticsEnabled = true
    var wheelSpeed = 1.25
    var onChange: ((CGFloat) -> Void)?
    var onEnd: ((Int) -> Void)?

    private var settleWorkItem: DispatchWorkItem?
    private var lastWheelStepTime: TimeInterval = 0
    private var wheelExtraSteps = 0.0
    private var lastWheelDirection = 0

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard NSApp.currentEvent?.type == .scrollWheel else { return nil }
        return self
    }

    override func scrollWheel(with event: NSEvent) {
        guard upperBound > lowerBound else { return }
        let speed = min(max(wheelSpeed, 0.5), 2.0)
        let horizontalDelta = event.scrollingDeltaX
        let verticalDelta = event.scrollingDeltaY
        let delta = abs(horizontalDelta) > abs(verticalDelta)
            ? horizontalDelta
            : verticalDelta
        guard abs(delta) > 0.01 else { return }

        if event.hasPreciseScrollingDeltas {
            let previousIndex = Int(progress.rounded())
            let travel = max(bounds.width * 0.72, 260) / speed
            let nextProgress = min(
                max(progress - delta / travel, lowerBound),
                upperBound
            )
            progress = nextProgress
            performHapticIfNeeded(from: previousIndex, to: Int(nextProgress.rounded()))
            onChange?(nextProgress)
            scheduleSettle()
        } else {
            guard event.timestamp - lastWheelStepTime > 0.12 / speed else { return }
            lastWheelStepTime = event.timestamp
            let direction = delta > 0 ? -1 : 1
            if direction != lastWheelDirection {
                wheelExtraSteps = 0
                lastWheelDirection = direction
            }
            wheelExtraSteps += max(speed - 1, 0)
            let extraSteps = Int(wheelExtraSteps)
            wheelExtraSteps -= Double(extraSteps)
            let target = min(
                max(Int(progress.rounded()) + direction * (1 + extraSteps), Int(lowerBound)),
                Int(upperBound)
            )
            performHapticIfNeeded(from: Int(progress.rounded()), to: target)
            progress = CGFloat(target)
            onEnd?(target)
        }
    }

    private func performHapticIfNeeded(from previousIndex: Int, to index: Int) {
        guard hapticsEnabled, previousIndex != index else { return }
        NSHapticFeedbackManager.defaultPerformer.perform(
            .alignment,
            performanceTime: .now
        )
    }

    private func scheduleSettle() {
        settleWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let target = min(
                max(Int(self.progress.rounded()), Int(self.lowerBound)),
                Int(self.upperBound)
            )
            self.onEnd?(target)
        }
        settleWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14, execute: workItem)
    }
}
