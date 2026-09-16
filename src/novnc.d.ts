declare module '@novnc/novnc' {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);
    scaleViewport: boolean;
    resizeSession: boolean;
    disconnect(): void;
    sendCtrlAltDel(): void;
    focus?(): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  }
}
