import { X } from 'lucide-react';

/**
 * Shared right-side panel shell — the one position: fixed mechanism for
 * entity detail panels (Incident, FieldCommand). Generalized from
 * IncidentDetailsPanel.jsx's original header+close+scrollable-body
 * structure (right/top/bottom-anchored, 24rem wide, zIndex 2000).
 *
 * The body is intentionally unopinionated about scrolling/padding — each
 * consumer (e.g. a tabbed panel where only some tabs scroll, like
 * IncidentDetailsPanel's Events tab) renders its own scrollable wrapper as
 * `children`, exactly as before extraction.
 */
export function SidePanel({ icon, title, subtitle, onClose, footer, children }) {
  return (
    <div className="cc-panel" style={{ height: '100%', minHeight: 0 }}>
      {/* Header - Fixed Height (shrink-0) */}
      <div className="cc-header p-4 border-b border-slate-700 flex justify-between items-start" style={{ flexShrink: 0 }}>
        <div className="cc-header-left flex gap-3">
          {icon && <div className="cc-icon-circle p-2 bg-slate-800 rounded-full">{icon}</div>}
          <div>
            <div className="cc-title font-bold text-lg">{title}</div>
            {subtitle && (
              <div className="cc-subtitle text-sm text-slate-400 flex items-center">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div className="cc-header-right flex items-center gap-2">
          <button className="cc-close hover:bg-slate-800 p-1 rounded" onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body — flex:1, minHeight:0 so a scrollable child can actually shrink and scroll */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>

      {footer}
    </div>
  );
}
