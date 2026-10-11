/** Pure vertical SGR wheel reports; keys, clicks, motion and mixed chunks fail closed. */
export function isTerminalWheelInput(data: string): boolean {
  return data.length > 0 && /^(?:\x1b\[<(?:64|65|68|69|72|73|80|81);\d+;\d+[Mm])+$/.test(data);
}
