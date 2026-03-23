export type Point = { x: number; y: number };

export enum ToolType {
  SELECT = 'SELECT',
  ROOM = 'ROOM',
  WALL = 'WALL',
  DOOR = 'DOOR',
  WINDOW = 'WINDOW',
  ERASER = 'ERASER'
}

export enum StyleType {
  MODERN = '现代简约',
  INDUSTRIAL = '工业风',
  CREAMY = '奶油风',
  JAPANDI = '原木风',
  EUROPEAN = '欧式',
  CHINESE = '中式'
}

export interface RoomData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  color: string;
  renderingUrl?: string;
}

export interface WallData {
  id: string;
  points: number[]; // [x1, y1, x2, y2]
}

export interface OpeningData {
  id: string;
  type: 'DOOR' | 'WINDOW';
  x: number;
  y: number;
  rotation: number;
  width: number;
}
