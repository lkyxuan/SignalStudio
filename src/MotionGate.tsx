import {createContext} from 'react';
import {newMotionGate} from './motionScene';
export const MotionContext=createContext(newMotionGate());
