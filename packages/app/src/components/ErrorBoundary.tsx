import { Component, type ReactNode } from "react";

/** A render error shows a message with a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; where?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error boundary">
        <strong>Something went wrong{this.props.where ? ` in ${this.props.where}` : ""}.</strong>
        {"\n"}{this.state.error.message}
        {"\n"}Reload the page; if it keeps happening, restore an earlier version from History.
        {"\n"}<button type="button" className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
