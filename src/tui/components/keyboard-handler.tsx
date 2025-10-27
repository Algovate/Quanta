import React, { useEffect } from 'react';
import { useInput } from 'ink';

interface KeyboardHandlerProps {
  onKeyPress: (input: string, key: any) => void;
  children: React.ReactNode;
}

export function KeyboardHandler({ onKeyPress, children }: KeyboardHandlerProps) {
  useInput((input, key) => {
    onKeyPress(input, key);
  });

  return <>{children}</>;
}
