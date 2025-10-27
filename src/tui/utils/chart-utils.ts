// ASCII chart generation utilities

export function generateSparkline(data: number[], width: number, height: number): string[] {
  if (data.length === 0) return Array(height).fill('').map(() => '─'.repeat(width));
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const chart: string[] = [];
  
  for (let y = height - 1; y >= 0; y--) {
    const line: string[] = [];
    const threshold = min + (range / height) * y;
    
    for (let x = 0; x < width; x++) {
      const index = Math.floor((x / width) * data.length);
      const value = data[index] || 0;
      
      if (value >= threshold) {
        line.push('█');
      } else {
        line.push(' ');
      }
    }
    
    chart.push(line.join(''));
  }
  
  return chart;
}

export function generateCandlestick(data: Array<{ open: number; high: number; low: number; close: number }>, width: number, height: number): string[] {
  if (data.length === 0) return Array(height).fill('').map(() => '─'.repeat(width));
  
  const prices = data.flatMap(c => [c.high, c.low]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  
  const chart: string[] = [];
  const points = data.length;
  const barWidth = Math.floor(width / points);
  
  for (let y = height - 1; y >= 0; y--) {
    const line: string[] = [];
    const threshold = min + (range / height) * y;
    
    for (let i = 0; i < data.length; i++) {
      const candle = data[i];
      const isGreen = candle.close >= candle.open;
      
      for (let b = 0; b < barWidth; b++) {
        if (candle.high >= threshold && candle.low <= threshold) {
          if (b === 0 || b === barWidth - 1) {
            line.push('│');
          } else if (candle.open <= threshold && candle.close >= threshold) {
            line.push(isGreen ? '█' : '▓');
          } else {
            line.push(' ');
          }
        } else if (candle.high >= threshold && candle.low > threshold) {
          line.push('│');
        } else if (candle.low <= threshold && candle.high < threshold) {
          line.push('│');
        } else {
          line.push(' ');
        }
      }
    }
    
    chart.push(line.join(''));
  }
  
  return chart;
}

export function generateGauge(value: number, min: number, max: number, width: number): string {
  const clampedValue = Math.max(min, Math.min(max, value));
  const percent = ((clampedValue - min) / (max - min)) * 100;
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function generateBarChart(labels: string[], values: number[], maxWidth: number): string[] {
  const max = Math.max(...values, 1);
  
  return labels.map((label, i) => {
    const barLength = Math.floor((values[i] / max) * maxWidth);
    const bar = '█'.repeat(barLength);
    return `${label}: ${bar}`;
  });
}
