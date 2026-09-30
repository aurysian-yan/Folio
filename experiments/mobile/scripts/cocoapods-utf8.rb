require 'cocoapods/executable'

# CocoaPods 1.16 的子进程输出为二进制编码，中文路径需恢复为有效 UTF-8。
module FolioUtf8CommandOutput
  def execute_command(*arguments)
    output = super
    return output unless output.encoding == Encoding::BINARY

    utf8 = output.dup.force_encoding(Encoding::UTF_8)
    utf8.valid_encoding? ? utf8 : output
  end
end

Pod::Executable.singleton_class.prepend(FolioUtf8CommandOutput)
