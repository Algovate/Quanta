declare module 'ink' {
  export function render(element: any): any;
  export function Box(props: any): any;
  export function Text(props: any): any;
  export function useInput(handler: (input: string, key: any) => void): void;
}
