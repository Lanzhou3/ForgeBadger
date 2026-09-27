import { Lexer, walkTokens, type Token, type Tokens } from 'marked';

export interface FeishuMessagePart { msg_type: 'post' | 'text'; content: string; plain: string }
// Leaves room for recipient, thread and UUID fields below Feishu's message envelope limit.
const partBytes = 10_000;
const replyBytes = 64 * 1024;
const truncatedNotice = '…内容过长，请在 Web Copilot 查看完整结果。';
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value),'utf8');
const fits = (part: FeishuMessagePart) => bytes({msg_type:part.msg_type,content:part.content}) <= partBytes;
const plainPart = (plain: string): FeishuMessagePart => ({msg_type:'text',content:JSON.stringify({text:plain}),plain});
function postPart(rows: {markdown:string;plain:string}[]): FeishuMessagePart {
  return {msg_type:'post',content:JSON.stringify({zh_cn:{content:rows.map(row=>[{tag:'md',text:row.markdown}])}}),
    plain:rows.map(row=>row.plain).join('\n\n')};
}

/** Keep the durable payload bounded; the formatter closes any cut fence before adding a notice. */
export function boundFeishuReply(source: string): string {
  if(Buffer.byteLength(source,'utf8')<=replyBytes) return source;
  let end=replyBytes;
  while(Buffer.byteLength(source.slice(0,end),'utf8')>replyBytes) end=Math.floor(end*0.9);
  if(/[\uD800-\uDBFF]/.test(source[end-1]??'')) end--;
  return source.slice(0,end)+'\n'+truncatedNotice;
}

/** Markdown stays Markdown; a standard GFM lexer supplies real block/fence boundaries. */
export function buildFeishuMessageParts(source: string): FeishuMessagePart[] {
  const bounded=boundFeishuReply(source);
  const truncated=bounded.endsWith('\n'+truncatedNotice);
  const text=truncated?bounded.slice(0,-truncatedNotice.length-1):bounded;
  const tokens=Lexer.lex(text,{gfm:true});
  const parts: FeishuMessagePart[]=[];
  let outputBytes=0,overflow=false;
  let rows: {markdown:string;plain:string}[]=[];
  const add=(part:FeishuMessagePart)=>{
    const size=bytes({msg_type:part.msg_type,content:part.content});
    if(parts.length>=23 || outputBytes+size>192*1024){overflow=true;return;}
    parts.push(part);outputBytes+=size;
  };
  const flush=()=>{if(rows.length)add(postPart(rows));rows=[];};
  for(const token of tokens) {
    if(overflow)break;
    if(token.type==='space' || token.type==='def') continue;
    const referenced=new Set<string>();
    walkTokens([token],child=>{
      if((child.type==='link' || child.type==='image') && child.raw.trimEnd().endsWith(']')) {
        const link=child as Tokens.Link;referenced.add(link.href+'\0'+(link.title??''));
      }
    });
    // Each md row is independent; include only definitions actually referenced in this block.
    const definitions=Object.entries(tokens.links).filter(([,link])=>referenced.has(link.href+'\0'+(link.title??'')))
      .map(([name,link])=>`[${name}]: <${link.href}>${link.title?' '+JSON.stringify(link.title):''}`).join('\n');
    const plain=neutralizeMentions(plainToken(token));
    const markdown=neutralizeMentions(markdownBlock(token)+(definitions?'\n\n'+definitions:''));
    const row={markdown,plain};
    if(fits(postPart([row])) && fits(plainPart(plain))) {
      if(!fits(postPart([...rows,row])) || !fits(plainPart([...rows,row].map(r=>r.plain).join('\n\n')))) flush();
      rows.push(row);
    } else {
      flush();
      // A single oversized block becomes readable text, never half a link/table/code fence.
      for(const chunk of splitPlain(plain)){if(overflow)break;add(plainPart(chunk));}
    }
  }
  flush();
  if(truncated || overflow) parts.push(plainPart(truncatedNotice));
  return parts;
}

function splitPlain(text: string): string[] {
  const points=Array.from(text);const chunks:string[]=[];let start=0;
  while(start<points.length) {
    let lo=start+1,hi=Math.min(points.length,start+partBytes),end=lo;
    while(lo<=hi) {
      const middle=Math.floor((lo+hi)/2);
      if(fits(plainPart(points.slice(start,middle).join('')))){end=middle;lo=middle+1;}else hi=middle-1;
    }
    let chunk=points.slice(start,end).join('');
    const newline=chunk.lastIndexOf('\n');
    if(end<points.length && newline>chunk.length/2) {chunk=chunk.slice(0,newline+1);end=start+Array.from(chunk).length;}
    chunks.push(chunk);start=end;
  }
  return chunks;
}

function markdownBlock(token: Token): string {
  if(token.type==='code') {
    const code=token as Tokens.Code;
    const fence='`'.repeat(Math.max(3,...Array.from(code.text.matchAll(/`+/g),m=>m[0].length+1)));
    return `${fence}${(code.lang??'').replace(/[^\w+-]/g,'')}\n${code.text}\n${fence}`;
  }
  if(token.type==='heading') {
    const heading=token as Tokens.Heading;
    return `${'#'.repeat(heading.depth)} ${heading.text}`;
  }
  // Do not turn model-produced platform tags into @all or native user mentions.
  return token.raw.trim();
}

function neutralizeMentions(text:string):string {
  return text.replace(/<\/?at\b[^>]*>/gi,tag=>tag.replace(/</g,'＜').replace(/>/g,'＞'));
}

function plainTokens(tokens: Token[]): string {
  let output='';
  for(const token of tokens) {
    output+=plainToken(token);
    if(output.length>replyBytes)return boundFeishuReply(output);
  }
  return output;
}
function plainToken(token: Token): string {
  switch(token.type) {
    case 'space': return '\n';
    case 'def': return '';
    case 'hr': return '────────\n';
    case 'code': return (token as Tokens.Code).text+'\n';
    case 'codespan': return (token as Tokens.Codespan).text;
    case 'br': return '\n';
    case 'link': case 'image': {
      const link=token as Tokens.Link | Tokens.Image;
      const label='tokens' in link && link.tokens?plainTokens(link.tokens):link.text;
      return label===link.href?label:`${label} (${link.href})`;
    }
    case 'list': {
      const list=token as Tokens.List;
      return list.items.map((item,index)=>`${list.ordered?`${Number(list.start)+index}.`:'•'} ${item.task?(item.checked?'[x] ':'[ ] '):''}${plainTokens(item.tokens).trim()}\n`).join('');
    }
    case 'table': {
      const table=token as Tokens.Table;
      return [table.header,...table.rows].map(row=>row.map(cell=>plainTokens(cell.tokens)).join(' | ')).join('\n')+'\n';
    }
    case 'blockquote': return plainTokens((token as Tokens.Blockquote).tokens)+'\n';
    case 'heading': case 'paragraph': return plainTokens((token as Tokens.Paragraph).tokens)+'\n';
    case 'strong': case 'em': case 'del': return plainTokens((token as Tokens.Strong).tokens);
    case 'text': case 'escape': {
      const text=token as Tokens.Text | Tokens.Escape;
      return 'tokens' in text && text.tokens?plainTokens(text.tokens):text.text;
    }
    default: return token.raw;
  }
}
