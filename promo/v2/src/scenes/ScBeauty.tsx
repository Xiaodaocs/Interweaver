import React from 'react';
import { CanvasStage } from '../components/CanvasStage';
import { draw } from '../gen/beauty';

export const ScBeauty: React.FC = () => (
  <CanvasStage beatFrom={40} draw={(g, b) => draw(g, b)} />
);
