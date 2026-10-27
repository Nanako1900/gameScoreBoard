import { SKELETON_DEFAULT_LINES } from '../lib/constants';
import './skeleton.css';

interface SkeletonProps { label: string; lines?: number; className?: string }

export function Skeleton({ label, lines = SKELETON_DEFAULT_LINES, className }: SkeletonProps): JSX.Element {
  return <div className={`skel${className ? ` ${className}` : ''}`} aria-busy="true">
    <span className="visually-hidden">{label}</span>
    {Array.from({ length: lines }, (_, index) => <span className="skel__line" key={index} aria-hidden="true" />)}
  </div>;
}
