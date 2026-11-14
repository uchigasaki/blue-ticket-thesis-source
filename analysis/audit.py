"""Reproduce the late-study score audit and published statistical comparisons.

The input is opened read-only. Only aggregate results and discrepancy counts
are written; identifiers, row values, dates, and free text stay in memory.
"""

from pathlib import Path
import argparse
import collections
import json
import math
import re

import numpy as np
import openpyxl
from openpyxl.utils import get_column_letter as col
import scipy
from scipy import stats
from scipy.special import gammaln

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('workbook', type=Path, help='local late-study workbook (XLSX)')
parser.add_argument('--prior-workbook', type=Path, help='optional earlier workbook with unchanged scores')
parser.add_argument('--out-dir', type=Path, required=True, help='directory for aggregate reports')
args = parser.parse_args()
OUT = args.out_dir

SHEETS = (
    'はじめに', 'ダッシュボード', '参加者一覧', '事前回答', '学習中回答',
    '事後回答', '1週間後回答', '問題別分析', '統計検定', '設問正答表', '検定用',
    '追加_統計分析', '追加_設問別分析', '追加_追跡欠測', '追加_考察例', '追加_グラフ',
)
RESPONSE_SHEETS = ('事前回答', '学習中回答', '事後回答', '1週間後回答')


def workbook_values(path, *, data_only):
    book = openpyxl.load_workbook(path, read_only=True, data_only=data_only)
    try:
        missing = set(SHEETS) - set(book.sheetnames)
        if missing:
            parser.error('The workbook does not have the expected late-study sheets.')
        return {name: list(book[name].values) for name in SHEETS}
    finally:
        book.close()


vals = workbook_values(args.workbook, data_only=True)
forms = workbook_values(args.workbook, data_only=False)
R = {
    'analysis_scope': 'Late-study arithmetic and statistical audit. The input dates are anonymized and are not used in the analysis.',
    'versions': {'numpy': np.__version__, 'scipy': scipy.__version__, 'openpyxl': openpyxl.__version__},
}

if args.prior_workbook:
    prior = workbook_values(args.prior_workbook, data_only=False)
    diff_counts = {}
    for sn in SHEETS:
        a, b = forms[sn], prior[sn]
        changed = 0
        for i in range(max(len(a), len(b))):
            ar = a[i] if i < len(a) else ()
            br = b[i] if i < len(b) else ()
            for j in range(max(len(ar), len(br))):
                x = ar[j] if j < len(ar) else None
                y = br[j] if j < len(br) else None
                changed += x != y
        if changed:
            diff_counts[sn] = changed
    R['prior_comparison'] = {
        'changed_cells': sum(diff_counts.values()),
        'changed_cells_by_sheet': diff_counts,
        'source_response_sheets_unchanged': all(
            forms[s] == prior[s] for s in ('参加者一覧', *RESPONSE_SHEETS, '設問正答表', '検定用')
        ),
    }

keys={row[1]:{'key':row[3],'row':i,'type':row[5]} for i,row in enumerate(vals['設問正答表'][1:],2) if row[1]}
R['key_count']=len(keys)
R['formula_counts']={s:sum(isinstance(x,str) and x.startswith('=') for row in forms[s] for x in row) for s in forms}
R['formula_error_counts']={s:sum(isinstance(x,str) and re.match(r'^#(?:REF!|DIV/0!|VALUE!|NAME\?|N/A|NUM!|NULL!|SPILL!|CALC!)$',x) is not None for row in vals[s] for x in row) for s in vals}

participants=vals['参加者一覧'][1:]
n=len(participants)
if not n or any(len(r) < 36 or r[0] in (None, '') for r in participants):
    parser.error('The participant sheet contains rows outside the expected schema.')
if any(r[1] not in ('A', 'B', 'C') or r[2] not in ('A', 'B', 'C') for r in participants):
    parser.error('The participant sheet contains an unrecognized group or recruitment code.')
id_list=[r[0] for r in participants]
R['counts']={'participants':n,'unique_ids':len(set(id_list)), 'groups':dict(collections.Counter(r[1] for r in participants)), 'recruitment':dict(collections.Counter(r[2] for r in participants))}
if len(set(id_list)) != n or any(len(vals[name]) != n + 1 for name in RESPONSE_SHEETS):
    parser.error('Participant IDs are not unique or the response sheets have unequal row counts.')
R['source_metadata_alignment']={s:sum(tuple(r[:3])!=tuple(participants[i][:3]) for i,r in enumerate(vals[s][1:])) for s in RESPONSE_SHEETS}
if any(R['source_metadata_alignment'].values()):
    parser.error('Participant, group or recruitment rows do not align across response sheets.')
R['group_recruitment_cross_tab']={g:dict(collections.Counter(r[2] for r in participants if r[1]==g)) for g in 'ABC'}

issues=collections.Counter()
def eq(a,b,tol=1e-10):
    if a is None or b is None:return a is None and b is None
    if isinstance(a,(int,float)) and isinstance(b,(int,float)):return math.isclose(a,b,rel_tol=tol,abs_tol=tol)
    return a==b
def check(sn,row,column,expected,label):
    actual=vals[sn][row-1][column-1]
    if not eq(actual,expected):issues[(sn,label)]+=1
def formcheck(sn,row,column,expected,label):
    actual=forms[sn][row-1][column-1]
    if actual!=expected:issues[(sn,label)]+=1

scored={};missing_responses=collections.Counter();score_checks=collections.Counter()
configs=[('事前回答',[f'pre_q{i}' for i in range(6,13)],4,11),('学習中回答',[f'q{i}' for i in range(1,13)],4,16),('事後回答',[f'post_q{i}' for i in range(1,11)]+[f'late_post_transfer_{a}' for a in ['stop','pedestrian','phone','age']],4,18),('1週間後回答',[f'late_followup_transfer_{a}' for a in ['stop','pedestrian','phone','age']],6,10)]
for sn,qids,start,correctstart in configs:
    allscores=[]
    for rowno,row in enumerate(vals[sn][1:],2):
        follow=sn=='1週間後回答';answered=(row[3]==1) if follow else True
        scores=[]
        for j,qid in enumerate(qids):
            response=row[start+j-1]
            k=keys[qid]
            if answered and (response is None or response==''):missing_responses[sn]+=1
            score=int(response==k['key']) if answered else None
            scores.append(score)
            check(sn,rowno,correctstart+j,score,'response rescored against final key')
            kr=k['row'];anscell=f'{col(start+j)}{rowno}'
            expected=f'=IF({anscell}=設問正答表!$D${kr},1,0)'
            if follow:expected=f'=IF($D{rowno}=0,"",IF({anscell}=設問正答表!$D${kr},1,0))'
            formcheck(sn,rowno,correctstart+j,expected,'correctness formula references key')
            score_checks[sn]+=1
        allscores.append(scores)
        if sn=='事前回答':
            check(sn,rowno,18,sum(scores),'7 item sum');check(sn,rowno,19,sum(scores)/7,'7 item rate')
        elif sn=='学習中回答':
            check(sn,rowno,28,sum(scores),'12 item sum');check(sn,rowno,29,sum(scores)/12,'12 item rate')
        elif sn=='事後回答':
            for cc,ss in [(32,sum(scores[:7])),(33,sum(scores[:10])),(34,sum(scores[10:]))]:check(sn,rowno,cc,ss,'score sum')
        else:
            check(sn,rowno,14,sum(scores) if answered else None,'follow sum missing distinct from zero')
            check(sn,rowno,15,sum(scores)/4 if answered else None,'follow rate missing distinct from zero')
            if not answered:
                for j in range(5,20):check(sn,rowno,j,None,'all follow fields null for nonresponse')
    scored[sn]=allscores
R['score_checks']={'correctness_cells_checked':dict(score_checks),'missing_responses_among_answered':dict(missing_responses)}

records=[]
for i,r in enumerate(participants):
    rn=i+2;pre=sum(scored['事前回答'][i]);post=sum(scored['事後回答'][i][:7]);post10=sum(scored['事後回答'][i][:10]);transfer=sum(scored['事後回答'][i][10:]);fr=vals['1週間後回答'][i+1];answered=fr[3]
    follow=sum(scored['1週間後回答'][i]) if answered==1 else None
    expected={12:pre,13:post,14:pre/7,15:post/7,16:(post-pre)/7,17:post10,18:post10/10,19:transfer,20:transfer/4,21:answered,22:follow,23:follow/4 if answered==1 else None,24:(follow-transfer)/4 if answered==1 else None}
    for cc,e in expected.items():check('参加者一覧',rn,cc,e,'linked participant score/rate')
    expectedform={12:f'=事前回答!R{rn}',13:f'=事後回答!AF{rn}',14:f'=L{rn}/7',15:f'=M{rn}/7',16:f'=O{rn}-N{rn}',17:f'=事後回答!AG{rn}',18:f'=Q{rn}/10',19:f'=事後回答!AH{rn}',20:f'=S{rn}/4',21:f"='1週間後回答'!D{rn}",22:f'=IF(U{rn}=0,"",\'1週間後回答\'!N{rn})',23:f'=IF(U{rn}=0,"",\'1週間後回答\'!O{rn})',24:f'=IF(U{rn}=0,"",W{rn}-T{rn})'}
    for cc,e in expectedform.items():formcheck('参加者一覧',rn,cc,e,'participant formula')
    check('参加者一覧',rn,28,sum(r[24:27]),'time total')
    check('参加者一覧',rn,26,vals['学習中回答'][i+1][29],'learning time source')
    check('参加者一覧',rn,29,vals['学習中回答'][i+1][30],'explanation seconds source')
    for k in range(7):check('参加者一覧',rn,30+k,vals['事後回答'][i+1][34+k],'post subjectives source')
    records.append({'group':r[1],'pre':pre/7,'post':post/7,'improve':(post-pre)/7,'post10':post10/10,'post4':transfer/4,'follow4':follow/4 if answered==1 else None,'answered':answered,'learn_minutes':r[25],'explain_seconds':r[28], 'additional_learning':fr[18] if fr[18] in ('A','B','C') else 'missing_or_other'})

def desc(x):
    a=np.array(x,dtype=float)
    se=a.std(ddof=1)/np.sqrt(len(a));q=stats.t.ppf(.975,len(a)-1)
    return {'n':len(a),'mean':float(a.mean()),'sd':float(a.std(ddof=1)),'ci95_mean_unadjusted':[float(a.mean()-q*se),float(a.mean()+q*se)],'median':float(np.median(a)),'min':float(a.min()),'max':float(a.max())}
groups={g:[r for r in records if r['group']==g] for g in 'ABC'}
R['descriptive']={g:{k:desc([r[k] for r in rr if r[k] is not None]) for k in ['pre','post','improve','post10','post4','follow4','learn_minutes','explain_seconds']} for g,rr in groups.items()}
R['follow_missing']={'answered':sum(r['answered']==1 for r in records),'missing':sum(r['answered']==0 for r in records),'nonresponse_correctness_nonblank':sum(x is not None for row,rr in zip(scored['1週間後回答'],records) if rr['answered']==0 for x in row),'valid_zero_scores':sum(r['follow4']==0 for r in records if r['answered']==1),'by_group':{g:{'responders':sum(r['answered']==1 for r in rr),'missing':sum(r['answered']==0 for r in rr),'respondents_post4':desc([r['post4'] for r in rr if r['answered']==1]),'nonrespondents_post4':desc([r['post4'] for r in rr if r['answered']==0]),'additional_learning':dict(collections.Counter(r['additional_learning'] for r in rr if r['answered']==1))} for g,rr in groups.items()}}
R['matched_post_followup'] = {}
R['perfect_post_application'] = {}
for g, rr in groups.items():
    matched = [r for r in rr if r['answered'] == 1]
    post_mean = float(np.mean([r['post4'] for r in matched]))
    followup_mean = float(np.mean([r['follow4'] for r in matched]))
    R['matched_post_followup'][g] = {
        'n': len(matched),
        'post4_mean': post_mean,
        'follow4_mean': followup_mean,
        'followup_minus_post_pp': (followup_mean - post_mean) * 100,
    }
    perfect = sum(r['post4'] == 1 for r in rr)
    R['perfect_post_application'][g] = {
        'n': len(rr),
        'perfect_n': perfect,
        'perfect_proportion': perfect / len(rr),
    }

# The thesis also uses the descriptive summaries of age, prior experience,
# attitudes, and item-level transfer performance. Only aggregate values leave
# this script; the presence of free text is counted without reproducing it.
summary_fields = {
    'age': 4,
    'post_understanding': 29,
    'post_confidence': 30,
    'post_intention': 31,
    'post_scenario_helpfulness': 32,
    'post_mental_effort': 33,
}
R['group_profiles'] = {}
R['transfer_item_correctness'] = {}
for g in 'ABC':
    indices = [i for i, row in enumerate(participants) if row[1] == g]
    group_rows = [participants[i] for i in indices]
    R['group_profiles'][g] = {
        'prior_exposure': {
            label: sum(row[8] == code for row in group_rows)
            for code, label in (('A', 'yes'), ('B', 'no'), ('C', 'not_sure'))
        },
        'free_text_present': sum(row[35] not in ('', None) for row in group_rows),
        **{
            label: desc([row[i] for row in group_rows if isinstance(row[i], (int, float))])
            for label, i in summary_fields.items()
        },
    }
    R['transfer_item_correctness'][g] = {}
    for source, phase, offset in (
        ('事後回答', 'post', 10),
        ('1週間後回答', 'followup', 0),
    ):
        items = {}
        for j, item in enumerate(('stop', 'pedestrian', 'phone', 'age')):
            responses = [
                scored[source][i][offset + j] for i in indices
                if scored[source][i][offset + j] is not None
            ]
            items[item] = {'n': len(responses), 'correct': sum(responses)}
        R['transfer_item_correctness'][g][phase] = items


def array(g,k):return np.array([r[k] for r in groups[g] if r[k] is not None],dtype=float)
def one_sample(d):
    n=len(d);m=d.mean();se=d.std(ddof=1)/np.sqrt(n);test=stats.ttest_1samp(d,0);ci=stats.t.ppf(.975,n-1)*se
    return {'mean_pp':m*100,'ci95_pp':[(m-ci)*100,(m+ci)*100],'t':float(test.statistic),'df':float(test.df),'p':float(test.pvalue)}
def pair(a,b):
    n1,n2=len(a),len(b);v1,v2=a.var(ddof=1),b.var(ddof=1);d=b.mean()-a.mean();se=np.sqrt(v1/n1+v2/n2);df=(v1/n1+v2/n2)**2/((v1/n1)**2/(n1-1)+(v2/n2)**2/(n2-1));q=stats.t.ppf(.975,df);t=d/se;p=2*stats.t.sf(abs(t),df);pooled=np.sqrt(((n1-1)*v1+(n2-1)*v2)/(n1+n2-2));japprox=1-3/(4*(n1+n2-2)-1);jexact=np.exp(gammaln((n1+n2-2)/2)-.5*np.log((n1+n2-2)/2)-gammaln((n1+n2-3)/2))
    return {'n1':n1,'n2':n2,'diff_pp':float(d*100),'ci95_unadjusted_pp':[float((d-q*se)*100),float((d+q*se)*100)],'t':float(t),'df':float(df),'p':float(p),'hedges_g_approx':float(japprox*d/pooled),'hedges_g_exact':float(jexact*d/pooled)}
def holm(ps):
    order=np.argsort(ps);r=np.empty(len(ps));last=0
    for j,i in enumerate(order):last=max(last,(len(ps)-j)*ps[i]);r[i]=min(last,1)
    return list(map(float,r))

R['paired_improvement']={g:one_sample(array(g,'improve')) for g in groups}
R['welch_pairwise']={}
for k in ['improve','post4','follow4']:
    res={f'{a}_vs_{b}':pair(array(a,k),array(b,k)) for a,b in [('A','B'),('A','C'),('B','C')]}
    hs=holm([v['p'] for v in res.values()])
    for v,h in zip(res.values(),hs):v['holm_p_within_3_pairs']=h
    R['welch_pairwise'][k]=res
R['welch_anova']={}
for k in ['pre','improve','post4','follow4']:
    arrays=[array(g,k) for g in groups];rr=stats.f_oneway(*arrays,equal_var=False)
    ns=np.array([len(a) for a in arrays]);vs=np.array([a.var(ddof=1) for a in arrays]);ws=ns/vs;ww=ws/ws.sum();tmp=np.sum((1-ww)**2/(ns-1))/(len(arrays)**2-1)
    R['welch_anova'][k]={'F':float(rr.statistic),'df1':len(arrays)-1,'df2':float(1/(3*tmp)),'p':float(rr.pvalue)}

for ri,g in enumerate('ABC',6):
    p=R['paired_improvement'][g]['p'];check('統計検定',ri,5,p,'paired dynamic p');check('統計検定',ri,6,p,'paired fixed p')
for k,start in [('improve',9),('post4',12),('follow4',15)]:
    for j,res in enumerate(R['welch_pairwise'][k].values()):
        check('統計検定',start+j,5,res['p'],'Welch dynamic p');check('統計検定',start+j,6,res['p'],'Welch fixed p')
for ri,g in enumerate('ABC',7):
    rr=groups[g];ss=R['descriptive'][g];nf=sum(r['answered']==1 for r in rr)
    vv=[len(rr),nf,nf/len(rr),ss['pre']['mean'],ss['post']['mean'],ss['improve']['mean']*100,ss['post4']['mean'],ss['follow4']['mean'],ss['learn_minutes']['mean']]
    for cc,e in enumerate(vv,2):check('追加_統計分析',ri,cc,e,'fixed descriptive')
for ri,g in enumerate('ABC',15):
    rr=R['paired_improvement'][g]
    vv=[rr['mean_pp'],*rr['ci95_pp'],rr['t'],rr['df'],rr['p']]
    for cc,e in enumerate(vv,2):check('追加_統計分析',ri,cc,e,'fixed paired result')
for ri,k in enumerate(['pre','improve','post4','follow4'],21):
    check('追加_統計分析',ri,2,R['welch_anova'][k]['F'],'fixed Welch ANOVA');check('追加_統計分析',ri,3,R['welch_anova'][k]['p'],'fixed Welch ANOVA')
for k,start in [('improve',28),('post4',31),('follow4',34)]:
    for j,rr in enumerate(R['welch_pairwise'][k].values()):
        vv=[rr['diff_pp'],*rr['ci95_unadjusted_pp'],rr['p'],rr['holm_p_within_3_pairs'],rr['hedges_g_approx']]
        for cc,e in enumerate(vv,3):check('追加_統計分析',start+j,cc,e,'fixed pairwise result')

# Independent OLS ANCOVA (post7 ~ intercept + B + C + pre7), HC3 sandwich SE.
X=np.array([[1,int(r['group']=='B'),int(r['group']=='C'),r['pre']] for r in records],dtype=float)
y=np.array([r['post'] for r in records]);inv=np.linalg.inv(X.T@X);beta=inv@X.T@y;resid=y-X@beta;hat=np.einsum('ij,jk,ik->i',X,inv,X);cov=inv@(X.T@(((resid/(1-hat))**2)[:,None]*X))@inv
R['ancova_hc3']={}
for name,v in [('B_minus_A',np.array([0,1,0,0])),('C_minus_A',np.array([0,0,1,0])),('C_minus_B',np.array([0,-1,1,0]))]:
    effect=v@beta;se=np.sqrt(v@cov@v);z=effect/se;p=2*stats.norm.sf(abs(z));q=stats.norm.ppf(.975)
    R['ancova_hc3'][name]={'difference_pp':float(effect*100),'ci95_normal_pp':list(map(float,[(effect-q*se)*100,(effect+q*se)*100])),'p_normal':float(p)}
for ri,rr in enumerate(R['ancova_hc3'].values(),41):
    for cc,e in enumerate([rr['difference_pp'],*rr['ci95_normal_pp'],rr['p_normal']],2):check('追加_統計分析',ri,cc,e,'fixed ANCOVA HC3 normal result')

# Check analytical helper alignment against source-corrected participant scores.
for gi,g in enumerate('ABC'):
    rr=groups[g]
    for i,rec in enumerate(rr,2):
        for j,k in enumerate(['pre','post','improve','post4','follow4','post10'],1):check('検定用',i,gi*6+j,rec[k],'test-helper group aligned values')
    ff=[r['follow4'] for r in rr if r['answered']==1]
    for i in range(2,len(rr)+2):check('検定用',i,20+gi,ff[i-2] if i-2<len(ff) else None,'follow-complete-only helper')

R['qc_issues']=[{'sheet':sheet,'check':label,'count':count} for (sheet,label),count in sorted(issues.items())]
R['qc_issue_count']=sum(issues.values())
R['report_conventions']={'percent_values':'pre/post/post4/follow4 stored as 0-1 fractions; multiply by100 for percentage values. Improvement and difference inferential outputs *_pp already multiplied by100.', 'holm_family':'3 group pairwise comparisons separately within each outcome (improvement, post4, follow4); not a nine-comparison family.', 'ci':'95% t confidence intervals are unadjusted individual intervals; not Holm-adjusted or simultaneous confidence intervals.', 'ancova':'post7 fraction dependent variable; intercept + group B/C indicators + baseline pre7 fraction; HC3 sandwich covariance; asymptotic normal z p and confidence intervals. No adjustment for recruitment, prior exposure, language, or versions.', 'fixed_stats':'Current cached and fixed values match independent calculations. Fixed inferential results do not auto-update after data changes. Condensed follow-only helper references and T.TEST ranges are fixed to current follow count.'}
def default(x):
    if isinstance(x,np.generic):return x.item()
    raise TypeError(type(x).__name__)
OUT.mkdir(parents=True, exist_ok=True)
(OUT/'audit_results.json').write_text(json.dumps(R,ensure_ascii=False,indent=2,default=default),encoding='utf-8')
with (OUT/'word_descriptive.tsv').open('w',encoding='utf-8-sig') as st:
    st.write('群\t人数\t事前7問 mean (SD), %\t事後対応7問 mean (SD), %\t改善量 mean (SD), pp\t改善量95%CI, pp\t事後応用4問 mean (SD), %\t追跡人数\t追跡応用4問 mean (SD), %\n')
    for g in 'ABC':
        d=R['descriptive'][g];ci=R['paired_improvement'][g]['ci95_pp']
        fmt=lambda k:f'{d[k]["mean"]*100:.2f} ({d[k]["sd"]*100:.2f})'
        st.write('\t'.join([g,str(d['pre']['n']),fmt('pre'),fmt('post'),fmt('improve'),f'{ci[0]:.2f}–{ci[1]:.2f}',fmt('post4'),str(d['follow4']['n']),fmt('follow4')])+'\n')
with (OUT/'word_pairwise.tsv').open('w',encoding='utf-8-sig') as st:
    st.write('指標\t比較\t差（後者−前者）, pp\t未調整95%CI, pp\tWelch df\t生p\tHolm調整p\tHedges g\n')
    for k,label in [('improve','改善量'),('post4','事後応用4問'),('follow4','追跡応用4問')]:
        for pairname,d in R['welch_pairwise'][k].items():
            ci=d['ci95_unadjusted_pp'];st.write('\t'.join([label,pairname,f'{d["diff_pp"]:.2f}',f'{ci[0]:.2f}–{ci[1]:.2f}',f'{d["df"]:.2f}',f'{d["p"]:.6g}',f'{d["holm_p_within_3_pairs"]:.6g}',f'{d["hedges_g_approx"]:.3f}'])+'\n')
print(json.dumps({
    'participants': R['counts']['participants'],
    'followup_responses': R['follow_missing']['answered'],
    'qc_issue_count': R['qc_issue_count'],
}, ensure_ascii=False))
raise SystemExit(1 if issues else 0)
