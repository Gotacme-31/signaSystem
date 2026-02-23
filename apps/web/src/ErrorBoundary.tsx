// apps/web/src/ErrorBoundary.tsx
import React from "react";

type Props = { children: React.ReactNode };

type State = {
  hasError: boolean;
  error: unknown | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("UI crashed:", error, info);
  }

  render() {
    if (this.state.hasError) {
      const msg =
        this.state.error instanceof Error
          ? this.state.error.message
          : typeof this.state.error === "string"
          ? this.state.error
          : JSON.stringify(this.state.error);

      return (
        <div style={{ padding: 16, fontFamily: "system-ui" }}>
          <h2>Se cayó la pantalla</h2>
          <p>Recarga para continuar.</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{msg}</pre>
          <button onClick={() => window.location.reload()}>Recargar</button>
        </div>
      );
    }

    return this.props.children;
  }
}