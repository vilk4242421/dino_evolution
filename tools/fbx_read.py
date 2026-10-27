# Минимальный читатель бинарного FBX (7.x): сетка, UV, нормали, скелет (Model/LimbNode), скиннинг (Deformer/Cluster), анимационные кривые.
# Использование: from fbx_read import load; F = load(path)
import struct, zlib, numpy as np

class Node:
    __slots__ = ('name', 'props', 'children')
    def __init__(s, name): s.name = name; s.props = []; s.children = []
    def get(s, name):
        for c in s.children:
            if c.name == name: return c
        return None
    def all(s, name): return [c for c in s.children if c.name == name]

def parse(path):
    d = open(path, 'rb').read(); assert d[:20] == b'Kaydara FBX Binary  ', 'не бинарный FBX'
    ver = struct.unpack('<I', d[23:27])[0]; wide = ver >= 7500
    def rd(pos):
        if wide: end, nprop, plen, nl = struct.unpack('<QQQB', d[pos:pos + 25]); pos += 25
        else: end, nprop, plen, nl = struct.unpack('<IIIB', d[pos:pos + 13]); pos += 13
        if end == 0: return None, pos
        n = Node(d[pos:pos + nl].decode('latin1')); pos += nl; pend = pos + plen
        for _ in range(nprop):
            t = chr(d[pos]); pos += 1
            if t == 'Y': n.props.append(struct.unpack('<h', d[pos:pos + 2])[0]); pos += 2
            elif t == 'C': n.props.append(d[pos]); pos += 1
            elif t == 'I': n.props.append(struct.unpack('<i', d[pos:pos + 4])[0]); pos += 4
            elif t == 'F': n.props.append(struct.unpack('<f', d[pos:pos + 4])[0]); pos += 4
            elif t == 'D': n.props.append(struct.unpack('<d', d[pos:pos + 8])[0]); pos += 8
            elif t == 'L': n.props.append(struct.unpack('<q', d[pos:pos + 8])[0]); pos += 8
            elif t in 'fdlib':
                cnt, enc, clen = struct.unpack('<III', d[pos:pos + 12]); pos += 12
                raw = d[pos:pos + clen]; pos += clen
                if enc: raw = zlib.decompress(raw)
                dt = {'f': '<f4', 'd': '<f8', 'l': '<i8', 'i': '<i4', 'b': 'u1'}[t]
                n.props.append(np.frombuffer(raw, dtype=dt, count=cnt))
            elif t in 'SR':
                ln = struct.unpack('<I', d[pos:pos + 4])[0]; pos += 4; raw = d[pos:pos + ln]; pos += ln
                n.props.append(raw.decode('latin1') if t == 'S' else raw)
            else: raise ValueError('тип ' + t)
        while pos < end:
            c, pos = rd(pos)
            if c is None: break
            n.children.append(c)
        return n, end
    root = Node('root'); pos = 27
    while pos < len(d) - 40:
        n, pos = rd(pos)
        if n is None: break
        root.children.append(n)
    return root

def p70(node):
    out = {}
    pr = node.get('Properties70') if node else None
    if pr:
        for c in pr.children:
            if c.name == 'P' and len(c.props) >= 5: out[c.props[0]] = c.props[4:]
    return out

def load(path):
    R = parse(path); O = R.get('Objects'); C = R.get('Connections')
    objs = {}
    for c in O.children:
        objs[c.props[0]] = c
    conns = [(x.props[0], x.props[1], x.props[2]) if x.props[0] == 'OO' else (x.props[0], x.props[1], x.props[2], x.props[3] if len(x.props) > 3 else '') for x in C.children]
    # дети/родители
    parent = {}; kids = {}; prop_link = []
    for c in conns:
        t, a, b = c[0], c[1], c[2]
        if t == 'OO': parent.setdefault(a, []).append(b); kids.setdefault(b, []).append(a)
        else: prop_link.append((a, b, c[3]))
    kind = lambda i: (objs[i].name + ':' + str(objs[i].props[2])) if i in objs and len(objs[i].props) > 2 else (objs[i].name if i in objs else '?')
    F = {'models': {}, 'geoms': {}, 'skins': {}, 'clusters': {}, 'anims': {}, 'names': {}, 'objs': objs, 'kids': kids, 'parent': parent, 'prop_link': prop_link, 'root': R}
    for i, o in objs.items():
        nm = o.props[1].split('\x00')[0] if len(o.props) > 1 and isinstance(o.props[1], str) else ''
        F['names'][i] = nm
        if o.name == 'Model':
            pp = p70(o)
            F['models'][i] = {'name': nm, 'type': o.props[2], 'T': pp.get('Lcl Translation', [0, 0, 0]), 'R': pp.get('Lcl Rotation', [0, 0, 0]), 'S': pp.get('Lcl Scaling', [1, 1, 1]),
                              'pre': pp.get('PreRotation', [0, 0, 0]), 'post': pp.get('PostRotation', [0, 0, 0]), 'rotorder': pp.get('RotationOrder', [0])[0] if 'RotationOrder' in pp else 0, 'parent': None}
    for i, m in F['models'].items():
        for p in parent.get(i, []):
            if p in F['models']: m['parent'] = p
    return F
