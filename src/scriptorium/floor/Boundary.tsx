// A floor that throws takes only the floor with it (§8.7: it is never the only route to anything).
//
// Without this, an error anywhere in Pixi or the actors unmounts the whole React root, rail and
// all, and the application opens on an empty window. That shipped once (DECISIONS 0021).

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Put the floor away and show the roster list instead. */
  onRoster: () => void;
}

export class FloorBoundary extends Component<Props, { error: string | null }> {
  override state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown) {
    console.error("the floor failed", error);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" data-testid="floor-failed" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="display text-md text-bone">The floor could not be drawn.</p>
        <p className="mono max-w-lg text-xs text-bone-dim">{this.state.error}</p>
        <p className="max-w-lg text-base text-bone-dim">
          Every familiar is still in the rail. Switch to the roster, or reload the window to try the floor again.
        </p>
        <button
          type="button"
          onClick={this.props.onRoster}
          className="rounded-mark border border-rule px-3 py-1 text-base text-bone hover:border-brass"
        >
          Show the roster
        </button>
      </div>
    );
  }
}
