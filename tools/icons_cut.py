from PIL import Image; import numpy as np
from scipy import ndimage
A=np.asarray(Image.open('sheet.png').convert('RGB')).astype(int)
B={ 'play':(67,89,93,97),'gear':(207,79,109,111),'trophy':(355,83,110,103),'exit':(512,88,98,95),'refresh':(922,86,92,94),'home':(1045,80,98,99),
 'dino':(1192,85,109,100),'map':(1314,87,102,92),'chest':(1546,84,98,97),
 'swords':(64,297,91,92),'crown':(194,294,110,91),'people':(342,295,101,91),'flag':(503,289,97,102),'podium':(1040,293,100,95),'medal':(1333,293,70,98),'chart':(1434,302,84,84),
 'dinohead':(40,498,102,82),'palette':(178,498,97,80),'shirt':(439,495,100,80),'gem':(570,500,88,78),'hanger':(690,500,91,70),
 'forest':(855,497,102,82),'mountain':(987,499,106,79),'desert':(1123,500,110,78),'ice':(1268,495,100,84),'volcano':(1399,496,105,84),'ocean':(1532,495,98,84),
 'heart':(53,670,70,68),'plus':(155,670,68,66),'bolt':(260,670,56,70),'shield':(343,666,66,74),'dna':(437,663,65,79),'star':(534,662,78,74),
 'sword':(689,665,81,80),'burst':(796,666,81,77),'snow':(887,662,75,83),'skull':(984,665,69,76),'fire':(1066,662,73,84),'virus':(1148,666,79,77),
 'hourglass':(1381,663,62,81),'boot':(1469,665,80,76),'leaf':(1568,661,74,83),
 'claws':(145,818,92,74),'meat':(255,817,85,78),'target':(367,821,75,74),'bone':(469,817,75,78),'feather':(1340,812,80,85),'storm':(1440,812,100,85),'bolt2':(1562,815,66,78),
 'herd':(695,820,92,75),'leader':(813,818,93,75),'paw':(40,822,78,72),'flagpink':(1040,812,110,90)}
def cut(a, name, tol=46):
    h,w,_=a.shape
    # фон — заливка от краёв по близости цвета (сумма |ΔRGB| < tol к соседнему уже фоновому пикселю): тёмный контур иконки (намного темнее) её останавливает
    seed=np.zeros((h,w),bool); seed[0]=seed[-1]=True; seed[:,0]=seed[:,-1]=True
    ref=np.median(np.r_[a[0],a[-1],a[:,0],a[:,-1]],axis=0)
    close=np.abs(a-ref).sum(2)<tol
    lab,_=ndimage.label(close); bl=set(np.unique(lab[seed]))-{0}; bg=np.isin(lab,list(bl))
    mx=a.max(2); mn=a.min(2); tile=(mx<=100)&((mx-mn)<48)&(mn>14)&(a[...,2]>a[...,0]+20)          # тёмная подложка плитки (не контур: у контура R почти 0)
    for _ in range(2):
        lab,_=ndimage.label(tile|bg); bl=set(np.unique(lab[bg]))-{0}; bg=np.isin(lab,list(bl))
    alpha=(~bg).astype(np.uint8)*255
    lab3,n3=ndimage.label(alpha>0)
    if n3>1:
        sz=ndimage.sum(np.ones_like(lab3),lab3,range(1,n3+1)); keep=np.isin(lab3,[i+1 for i,v in enumerate(sz) if v>=sz.max()*0.2]); alpha[~keep]=0
    alpha=ndimage.binary_fill_holes(alpha>0)*255
    alpha=ndimage.binary_erosion(alpha>0,iterations=1)*255
    al=ndimage.gaussian_filter(alpha.astype(float),0.6)
    im=Image.fromarray(np.dstack([a,np.clip(al,0,255)]).astype(np.uint8),'RGBA'); bb=im.getbbox(); im=im.crop(bb)
    s=max(im.size); c=Image.new('RGBA',(s,s)); c.paste(im,((s-im.size[0])//2,(s-im.size[1])//2)); return c.resize((96,96),Image.LANCZOS)
import os; os.makedirs('out',exist_ok=True)
for k,(x,y,w,hh) in B.items():
    m=5; a=A[max(0,y-m):y+hh+m, max(0,x-m):x+w+m]; cut(a,k).save('out/%s.png'%k)
for f,k in [('wings.png','wings'),('flask.png','flask')]:
    a=np.asarray(Image.open(f).convert('RGB')).astype(int)
    if k=='wings': a=a[:68]                                    # без подписи
    cut(a,k).save('out/%s.png'%k)
names=sorted(os.listdir('out')); W=Image.new('RGB',(12*104,((len(names)+11)//12)*120),(60,90,60))
from PIL import ImageDraw; d=ImageDraw.Draw(W)
for i,f in enumerate(names):
    im=Image.open('out/'+f); W.paste(im,((i%12)*104+4,(i//12)*120+4),im); d.text(((i%12)*104+4,(i//12)*120+102),f[:-4],fill=(255,255,255))
W.save('contact.png'); print(len(names))
