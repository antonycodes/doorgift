import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = this.state.error?.message || 'Unknown error';
      try {
        const parsed = JSON.parse(errorMessage);
        if (parsed.error) {
          errorMessage = `Lỗi truy cập dữ liệu: ${parsed.error}. Bạn có thể không có quyền truy cập (không phải Admin).`;
        }
      } catch (e) {
        // Not JSON
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-sans">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Đã xảy ra lỗi</h2>
            <p className="text-gray-700 mb-6">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-red-700 transition cursor-pointer"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
