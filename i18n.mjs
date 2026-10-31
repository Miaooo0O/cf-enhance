import {tagNames} from './tags.mjs';
// Exact UI phrases only. Never translate problem statements, source code,
// sample data, user names, problem names, editorial text or arbitrary prose.
const words={
  Home:'首页',Top:'热门',Catalog:'题目目录',Contests:'比赛',Gym:'训练场',Problemset:'题库',Groups:'群组',Rating:'评级',Edu:'课程',API:'API',Calendar:'日历',Help:'帮助',
  Problems:'题目',Submit:'提交',Status:'提交状态',Standings:'排行榜','Custom test':'自定义测试','My submissions':'我的提交',
  Enter:'登录',Register:'注册',Logout:'退出登录',Settings:'设置',Profile:'个人资料',Blog:'博客','Recent actions':'最近动态',
  'Filter Problems':'筛选题目',Difficulty:'难度',Solved:'通过人数',Name:'名称','Last submission':'最近提交','Last unsolved':'最近未通过',
  'Show tags for unsolved problems':'显示未通过题目的标签','Hide solved problems':'隐藏已通过题目','Add tag':'添加标签',Apply:'应用',Reset:'重置',Search:'搜索',
  'Problem tags':'题目标签','Contest materials':'比赛资料','Virtual participation':'虚拟参赛','Clone Contest to Mashup':'克隆比赛到混合赛',
  'Start virtual contest':'开始虚拟比赛','Clone Contest':'克隆比赛','Submit?':'提交代码','Pay attention':'注意',
  Language:'语言','Choose file':'选择文件','Choose File':'选择文件',File:'文件','Source code':'源代码',Problem:'题目',
  'Select problem':'选择题目','Select language':'选择语言',Send:'发送',Run:'运行',Test:'测试',Copy:'复制',Input:'输入',Output:'输出',
  'Download statement':'下载题面','Download':'下载','Add to favourites':'加入收藏','Remove from favourites':'取消收藏',
  'Before contest':'比赛开始前',Finished:'已结束',Practice:'练习','Contest is running':'比赛进行中',
  'Friends standings':'好友排名','Common standings':'总排行榜','Register now':'立即报名','Registration':'报名',
  'Participant':'参赛者','Participants':'参赛者','When':'提交时间','Who':'用户','Verdict':'结果','Time':'耗时','Memory':'内存',
  'In English':'英语','In Russian':'俄语','Submit solution':'提交代码','View':'查看','Save':'保存','Cancel':'取消','Close':'关闭','Next':'下一页','Previous':'上一页',
  Main:'主站',Friends:'好友',Favourites:'收藏',Favorites:'收藏',Tutorial:'题解',Tutorials:'题解',Announcement:'公告',Announcements:'公告','Contest status':'比赛状态','No tag edit access':'无标签编辑权限','Tag edit access':'编辑标签',
  'Show unofficial':'显示非正式参赛者','Show only friends':'只看好友','Hide':'隐藏','Show':'显示','All':'全部','All problems':'全部题目',
  'Accepted':'通过','Wrong answer':'答案错误','Time limit exceeded':'超过时间限制','Memory limit exceeded':'超过内存限制','Runtime error':'运行错误','Compilation error':'编译错误','In queue':'排队中','Running':'评测中',
  'Problem name':'题目名称','Contest name':'比赛名称','Start time':'开始时间','Duration':'时长','Participants count':'参赛人数','Registration completed':'已报名','Registration is running':'报名中','My participation':'我的参赛',
  'Statistics':'统计','Results':'结果','Final standings':'最终排名','Find':'查找','Clear':'清空','Upload':'上传','Choose':'选择','Optional':'可选','Required':'必填','Refresh':'刷新','Last update':'最近更新',
  'Heaps, binary search trees, segment trees, hash tables, etc':'堆、二叉搜索树、线段树、哈希表等',
  'Mathematics including integration, differential equations, etc':'数学，包括积分、微分方程等',
  'Geometry, computational geometry':'几何与计算几何','Graphs':'图论','Greedy algorithms':'贪心算法',
  'Number theory: Euler function, GCD, divisibility, etc':'数论：欧拉函数、最大公约数、整除等',
  'Games, Sprague–Grundy theorem':'博弈与 SG 定理','Implementation problems, programming technics, simulation':'实现题、编程技巧与模拟',
  'Prefix- and Z-functions, suffix structures, Knuth–Morris–Pratt algorithm, etc':'前缀函数、Z 函数、后缀结构、KMP 算法等',
  'Matrix multiplication, determinant, Cramer\'s rule, systems of linear equations':'矩阵乘法、行列式、克拉默法则与线性方程组',
  'Participants solved the problem':'通过该题的人数','With information transfer between solution runs':'多次程序运行之间传递信息',
  ...tagNames
};
const dictionary=new Map(Object.entries(words).map(([a,b])=>[a.toLowerCase(),b]));
const protectedSelector='.problem-statement,.problemindexholder,pre,code,textarea,script,style,.MathJax,.MathJax_Display,#cfe-root,#cfe-ac,[contenteditable]';
const uiSelector='.menu-box,.second-level-menu,#header .lang-chooser,#sidebar .caption,#sidebar .roundbox:has(.tag-box),.roundbox .caption,.contest-state-phase,table.problems tr:first-child,.datatable thead,.datatable tr:first-child,form[action*="/submit"],.submit-form,button,input[type="submit"],input[type="button"],.input-output-copier,label,.pagination,.tag-box,table.problems a.notice,#sidebar .bottom-links,.filter-box';
const routes=/^\/(?:$|top\/?$|catalog\/?$|contests\/?$|gyms\/?$|problemset(?:\/(?:submit|status|standings|customtest))?\/?$|groups\/my\/?$|ratings\/?$|edu\/courses\/?$|apiHelp\/?$|calendar\/?$|help\/?$|contest\/\d+\/(?:submit|my|status|standings|customtest|problems)\/?$)/;
function translated(text){
  // Preserve surrounding whitespace, arrows and punctuation.
  const match=text.match(/^(\s*(?:→\s*)?)(.*?)(\s*[:：]?\s*)$/s);if(!match)return null;
  const value=dictionary.get(match[2].replace(/\s+/g,' ').trim().toLowerCase());
  return value?match[1]+value+match[3]:null;
}
export function createTranslator(doc){
  let enabled=false;const records=new Map();
  function update(node,attr){
    const value=attr?node.getAttribute(attr):node.nodeValue;if(!value)return;
    let entry=records.get(node);const field=attr||'text';
    if(entry?.[field]?.translated===value)return;
    const next=translated(value);if(!next||next===value)return;
    entry||={};entry[field]={original:value,translated:next};records.set(node,entry);
    if(attr)node.setAttribute(attr,next);else node.nodeValue=next;
  }
  function process(element){
    if(element.closest?.(protectedSelector))return;
    function walk(n){for(const child of [...n.childNodes]){if(child.nodeType===3)update(child);else if(child.nodeType===1&&!child.matches(protectedSelector))walk(child);}}
    walk(element);
    for(const n of [element,...element.querySelectorAll('[title],[aria-label],input[type="submit"],input[type="button"]')]){
      if(n.closest(protectedSelector))continue;
      for(const attr of ['title','aria-label','placeholder'])update(n,attr);
      // A named submit value may be part of CF's form protocol.
      if(n.matches('input[type="submit"],input[type="button"]')&&!n.hasAttribute('name'))update(n,'value');
    }
  }
  function scan(root=doc){
    if(!enabled)return;
    if(root.nodeType===3){const parent=root.parentElement;if(parent?.closest(uiSelector)&&!parent.closest(protectedSelector))update(root);return;}
    // Walk only outer UI regions; nested matches were previously walked repeatedly.
    if(root.nodeType===1&&root.closest?.(protectedSelector))return;
    if(root.matches?.(uiSelector)||root.nodeType===1&&root.parentElement?.closest(uiSelector))process(root);
    else for(const n of root.querySelectorAll(uiSelector))if(!n.parentElement?.closest(uiSelector))process(n);
    for(const a of root.querySelectorAll('a[href]')){
      if(a.closest(protectedSelector))continue;
      let path;try{path=new URL(a.getAttribute('href'),'https://codeforces.com').pathname;}catch{continue;}
      if(routes.test(path))process(a);
    }
    if(root===doc||records.size>2048)for(const n of records.keys())if(!n.isConnected)records.delete(n);
  }
  return {scan,setEnabled(value){
    if(enabled===!!value)return;enabled=!!value;if(enabled){scan();return;}
    for(const [node,fields]of records){for(const [field,entry]of Object.entries(fields)){
      if(field==='text'){if(node.nodeValue===entry.translated)node.nodeValue=entry.original;}
      else if(node.getAttribute(field)===entry.translated)node.setAttribute(field,entry.original);
    }}records.clear();
  }};
}
