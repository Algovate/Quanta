import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import { TUIManager } from './manager.js';
import { KeyboardHandler } from './components/keyboard-handler.js';
import { DashboardLayout } from './layouts/dashboard.js';
import { HelpOverlay } from './components/dialogs/help-overlay.js';
import { TUIState } from './types.js';

interface TUIAppProps {
  manager: TUIManager;
  onExit?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

export function TUIApp({ manager, onExit, onPause, onResume, onStop }: TUIAppProps) {
  const [state, setState] = useState<TUIState>(manager.getState());
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setState(manager.getState());
    };

    manager.on('update', handleUpdate);

    return () => {
      manager.off('update', handleUpdate);
    };
  }, [manager]);

  const handleKeyPress = (input: string, key: any) => {
    switch (input) {
      case 'q':
      case 'Q':
        if (showHelp) {
          setShowHelp(false);
        } else if (onExit) {
          onExit();
        }
        break;

      case 'p':
      case 'P':
        if (!showHelp) {
          if (state.systemStatus.isPaused) {
            manager.resume();
            if (onResume) onResume();
          } else {
            manager.pause();
            if (onPause) onPause();
          }
        }
        break;

      case 's':
      case 'S':
        if (!showHelp) {
          manager.stop();
          if (onStop) onStop();
        }
        break;

      case 'r':
      case 'R':
        if (!showHelp) {
          // Force refresh
          setState(manager.getState());
        }
        break;

      case 'h':
      case 'H':
      case '?':
        // Toggle help
        setShowHelp(!showHelp);
        break;

      case '\u0003':
        // Ctrl+C
        if (onExit) onExit();
        break;

      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
        if (!showHelp) {
          // Switch to panel (placeholder)
          manager.addLog('info', `Switched to view ${input}`);
        }
        break;

      default:
        // Unknown key
        break;
    }
  };

  return (
    <KeyboardHandler onKeyPress={handleKeyPress}>
      {showHelp ? (
        <HelpOverlay onClose={() => setShowHelp(false)} />
      ) : (
        <DashboardLayout state={state} />
      )}
    </KeyboardHandler>
  );
}

export function renderTUI(manager: TUIManager, props: Omit<TUIAppProps, 'manager'>) {
  return render(<TUIApp manager={manager} {...props} />);
}
