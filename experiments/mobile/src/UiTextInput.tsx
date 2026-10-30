import { forwardRef, useState } from 'react';
import { TextInput as SystemTextInput, type TextInputProps } from 'react-native';
import { useUiTheme } from './UiTheme';
// 保留原生编辑、选区与 ref 接口，只统一应用表单外观和焦点反馈。
export const TextInput = forwardRef<SystemTextInput, TextInputProps>(function UiTextInput(props, ref) {
  const theme = useUiTheme();
  const [focused, setFocused] = useState(false);
  return <SystemTextInput {...props} ref={ref} onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
    style={[props.style, theme?.ui?.material && {
      minHeight: 56, borderRadius: theme.ui.shapes.field, paddingHorizontal: 16, paddingVertical: 12,
      color: theme.label, backgroundColor: theme.raised, borderWidth: focused ? 2 : 1,
      borderColor: focused ? theme.accent : theme.border,
    }]} />;
});
