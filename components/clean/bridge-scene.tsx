type BridgeSceneProps = {
  className?: string;
  index?: string;
  tone: 'alpine' | 'cedar' | 'ember';
};

export function BridgeScene({ className = '', index, tone }: BridgeSceneProps) {
  return (
    <div
      className={`bridge-card-art bridge-card-art-${tone} ${className}`.trim()}
      aria-hidden="true"
    >
      <span className="card-sun" />
      <span className="card-ridge card-ridge-far" />
      <span className="card-ridge card-ridge-near" />
      <span className="card-span" />
      {index ? <span className="card-index">{index}</span> : null}
    </div>
  );
}
