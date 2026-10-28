using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

[assembly: AssemblyTitle("Writee")]
[assembly: AssemblyDescription("Writee Markdown editor")]
[assembly: AssemblyProduct("Writee")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class WriteeLauncher
{
  // 按 Windows 命令行规则引用路径，保留空格、引号与末尾反斜杠。
  private static string Quote(string value)
  {
    return "\"" + Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"")
      .ReplaceEndSlashes() + "\"";
  }

  private static string ReplaceEndSlashes(this string value)
  {
    return Regex.Replace(value, @"(\\+)$", "$1$1");
  }

  [STAThread]
  private static int Main(string[] args)
  {
    try
    {
      var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
      var node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
      if (!File.Exists(node)) node = "node.exe";
      var arguments = new[] { Path.Combine(root, "scripts", "launch-writee.cjs") }.Concat(args);
      var start = new ProcessStartInfo(node, string.Join(" ", arguments.Select(Quote))) {
        WorkingDirectory = root,
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden
      };
      using (var process = Process.Start(start))
      {
        process.WaitForExit();
        if (process.ExitCode != 0) throw new Exception("Writee could not open this file. See writee-launch-error.log.");
        return process.ExitCode;
      }
    }
    catch (Exception error)
    {
      MessageBox.Show(error.Message, "Writee", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }
}
