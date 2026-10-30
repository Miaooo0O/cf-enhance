export const tagNames={
 '2-sat':'2-SAT','binary search':'二分查找',bitmasks:'位运算','brute force':'暴力枚举',combinatorics:'组合数学',constructive:'构造','constructive algorithms':'构造算法','data structures':'数据结构',dfs:'深度优先搜索','dfs and similar':'深度优先搜索等', 'divide and conquer':'分治',dp:'动态规划',dsu:'并查集','expression parsing':'表达式解析',fft:'快速傅里叶变换',flows:'网络流',games:'博弈论',geometry:'计算几何','graph matchings':'图匹配',graphs:'图论',greedy:'贪心',hashing:'哈希',implementation:'模拟实现',interactive:'交互题', 'chinese remainder theorem':'中国剩余定理','meet-in-the-middle':'折半搜索','number theory':'数论',math:'数学',matrices:'矩阵',probabilities:'概率论',schedules:'调度','shortest paths':'最短路',sortings:'排序','string suffix structures':'字符串后缀结构',strings:'字符串',ternary:'三分查找','ternary search':'三分查找',trees:'树','two pointers':'双指针', '*special':'特殊题', 'special':'特殊题',communication:'通信题'
};
export const displayTag=(tag,chinese=true)=>chinese&&tagNames[tag]?`${tagNames[tag]}（${tag}）`:tag;
export function normalizeTag(value){
 const text=value.trim();const bilingual=text.match(/[（(]([^（）()]+)[）)]$/)?.[1];
 if(bilingual&&tagNames[bilingual])return bilingual;
 const found=Object.keys(tagNames).find(t=>tagNames[t]===text)||text.toLowerCase();
 return ({ternary:'ternary search',special:'*special',constructive:'constructive algorithms',dfs:'dfs and similar'})[found]||found;
}
