/** A software keyboard changes the viewport ratio, not the device orientation. */
type OrientationView = Pick<Window, 'screen' | 'addEventListener' | 'removeEventListener'> & { orientation?: number };
export function deviceIsLandscape(view: OrientationView): boolean {
  const type = view.screen.orientation?.type;
  if (type?.startsWith('landscape')) return true;
  if (type?.startsWith('portrait')) return false;
  if (typeof view.orientation === 'number' && Number.isFinite(view.orientation)) return Math.abs(view.orientation) % 180 === 90;
  return view.screen.width > view.screen.height;
}
export function mountDeviceOrientation(view: OrientationView = window, root: HTMLElement = document.documentElement): () => void {
  const update = () => root.classList.toggle('device-landscape', deviceIsLandscape(view));
  update(); view.screen.orientation?.addEventListener('change', update); view.addEventListener('orientationchange', update);
  return () => {
    view.screen.orientation?.removeEventListener('change', update); view.removeEventListener('orientationchange', update);
    root.classList.remove('device-landscape');
  };
}
