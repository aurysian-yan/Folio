import SwiftUI

/// 选中时播放的系统符号动画：先消失再用绘制效果出现，用于导航与图标选择的选中反馈。
/// 绘制效果需要 macOS 26，旧系统与减弱动态效果下直接显示静态图标。
struct AnimatedSymbolIcon: View {
    let symbol: String
    let isSelected: Bool
    var speed: Double = 0.63

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isVisible = true

    var body: some View {
        ZStack {
            Image.englishSystemName(symbol)
                .opacity(0)
            icon
        }
        .onChange(of: isSelected) { _, selected in
            guard selected else { return }
            replay()
        }
    }

    @ViewBuilder
    private var icon: some View {
        if #available(macOS 26.0, *) {
            if isVisible {
                Image.englishSystemName(symbol)
                    .transition(AnyTransition.asymmetric(
                        insertion: AnyTransition(.symbolEffect(.drawOn, options: .speed(speed))),
                        removal: AnyTransition(.symbolEffect(.disappear, options: .speed(speed)))
                    ))
            }
        } else {
            Image.englishSystemName(symbol)
        }
    }

    private func replay() {
        guard #available(macOS 26.0, *), !reduceMotion else { return }
        withAnimation(.easeOut(duration: 0.33), completionCriteria: .removed) {
            isVisible = false
        } completion: {
            withAnimation(.easeIn(duration: 0.48)) {
                isVisible = true
            }
        }
    }
}
