import React from 'react';
import { CanvasStage } from '../components/CanvasStage';
import { SHOTS } from '../beats';
import { draw } from '../gen/prologue';

export const ScPrologue: React.FC = () => (
  <CanvasStage beatFrom={0} draw={(g, b) => draw(g, b)} />
);
