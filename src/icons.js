import { createElement, Camera, Image, Plus, List, Settings, Smile, Meh, Frown, X, ChevronRight, ArrowLeft, Download, LogOut, Utensils, Check, Leaf } from 'lucide';
const icons = { camera: Camera, image: Image, plus: Plus, list: List, settings: Settings, good: Smile, okay: Meh, bad: Frown, close: X, next: ChevronRight, back: ArrowLeft, download: Download, logout: LogOut, food: Utensils, check: Check, leaf: Leaf };
export function icon(name) { return createElement(icons[name] || Utensils, { width: 22, height: 22, 'aria-hidden': 'true', 'stroke-width': 1.7 }); }
