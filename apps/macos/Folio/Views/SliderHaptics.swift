import AppKit
import SwiftUI

private struct SliderHapticsModifier: ViewModifier {
    @AppStorage(AppPreferences.sliderHaptics) private var sliderHaptics = true

    let value: Double
    let range: ClosedRange<Double>
    let feedbackStep: Double?

    private var feedbackLevel: Int {
        if let feedbackStep, feedbackStep > 0 {
            return Int(((value - range.lowerBound) / feedbackStep).rounded())
        }
        let length = range.upperBound - range.lowerBound
        guard length > 0 else { return 0 }
        let progress = (value - range.lowerBound) / length
        return Int((progress * 24).rounded(.down))
    }

    func body(content: Content) -> some View {
        content.onChange(of: feedbackLevel) { oldValue, newValue in
            guard sliderHaptics, oldValue != newValue else { return }
            NSHapticFeedbackManager.defaultPerformer.perform(
                .levelChange,
                performanceTime: .now
            )
        }
    }
}

extension View {
    func sliderHaptics(
        value: Double,
        in range: ClosedRange<Double>,
        feedbackStep: Double? = nil
    ) -> some View {
        modifier(SliderHapticsModifier(
            value: value,
            range: range,
            feedbackStep: feedbackStep
        ))
    }
}
