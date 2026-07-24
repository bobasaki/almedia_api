import { forwardRef, type CSSProperties, type ReactNode } from "react";

/**
 * A card on the responsive insights grid. react-grid-layout drives position
 * and size by cloning this element and injecting `style`, `className`, drag
 * handlers, a ref, and the resize handle as extra children — so we forward all
 * of them and render our content through `body`. Dragging is bound to the
 * header via the grid's `draggableHandle`.
 */

interface GridWidgetProps {
  title: string;
  eyebrow?: string;
  headerExtra?: ReactNode;
  body: ReactNode;
  // Injected by react-grid-layout onto the grid item's child:
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export const GridWidget = forwardRef<HTMLDivElement, GridWidgetProps>(function GridWidget(
  { title, eyebrow, headerExtra, body, className, style, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`grid-widget panel ${className ?? ""}`}
      style={style}
      role="group"
      aria-label={title}
      {...rest}
    >
      <div className="widget-header">
        <div className="widget-title">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2>{title}</h2>
        </div>
        {headerExtra && <div className="widget-header-extra">{headerExtra}</div>}
        <span className="drag-hint" aria-hidden="true">
          ⠿
        </span>
      </div>
      <div className="widget-body">{body}</div>
      {children}
    </div>
  );
});
