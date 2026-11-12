/** Minimal authored-path fallback for Canvas hosts without browser Path2D.
 * The game's cached aircraft only use absolute M/L/C/Z commands.
 */
export function traceVectorPath(ctx: Pick<CanvasRenderingContext2D,'beginPath'|'moveTo'|'lineTo'|'bezierCurveTo'|'closePath'>, path: string): void {
  const tokens = path.match(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
  if (path.replace(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|[\s,]/gi,'')) throw new Error('Unsupported aircraft path command');
  let i=0, command='';
  const number=()=>{const token=tokens[i++];if(token===undefined||/^[MLCZ]$/i.test(token))throw new Error('Incomplete aircraft path');return Number(token);};
  ctx.beginPath();
  while(i<tokens.length){
    if(/^[MLCZ]$/.test(tokens[i]))command=tokens[i++];
    if(command==='Z'){ctx.closePath();command='';continue;}
    if(command==='M'){ctx.moveTo(number(),number());command='L';}
    else if(command==='L')ctx.lineTo(number(),number());
    else if(command==='C')ctx.bezierCurveTo(number(),number(),number(),number(),number(),number());
    else throw new Error('Unsupported aircraft path command');
  }
}
