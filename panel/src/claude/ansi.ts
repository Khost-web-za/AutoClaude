// CSI (colours, cursor moves), OSC (titles, links; BEL or ST terminated) and single-character escapes.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, '');
