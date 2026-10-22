import { useLayoutEffect, useRef } from "react";

// Decky routes may begin below Steam's header. 100vh on that route would
// otherwise put the composer under Steam's footer. Measure the rendered owner
// document, not the plugin's shared JS context.
export function useRouteFrame() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current, view = element?.ownerDocument.defaultView;
    if (!element || !view) return;
    const measure = () => {
      const value = `${Math.max(0, element.getBoundingClientRect().top)}px`;
      if (element.style.getPropertyValue("--dc-route-top") !== value) element.style.setProperty("--dc-route-top", value);
    };
    const observer = new view.ResizeObserver(measure);
    observer.observe(element.ownerDocument.documentElement);
    if (element.parentElement) observer.observe(element.parentElement);
    view.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); view.removeEventListener("resize", measure); };
  }, []);
  return ref;
}
