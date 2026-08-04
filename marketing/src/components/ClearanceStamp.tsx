export default function ClearanceStamp() {
  return (
    <div className="stamp" aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <defs>
          <path id="stampCircle" d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" />
        </defs>
        <circle className="stamp-ring" cx="60" cy="60" r="46" />
        <circle className="stamp-center" cx="60" cy="60" r="30" />
        <path
          className="stamp-center"
          d="M50 60l7 7 14-15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text className="stamp-text">
          <textPath href="#stampCircle" startOffset="0%">
            SIGNED &#8226; SANDBOXED &#8226; VERIFIED &#8226; SCANNED &#8226;{" "}
          </textPath>
        </text>
      </svg>
    </div>
  );
}
