# Курсор: зелёная лапа динозавра (paw) и кулачок без когтей при нажатии (fist), SVG 32×32. Готовые data-URL вписаны в game/index.html.
def paw(c1, c2, gid, claw='#fbf3e0', glow=False):
    def t(rot, y, w=1.0):
        return (f'<g transform="rotate({rot} 16 22)">'
                f'<path d="M{16-3.6*w} 22 L{16-1.9*w} {y} Q16 {y-2.2} {16+1.9*w} {y} L{16+3.6*w} 22 Z" fill="url(#{gid})"/>'
                f'<path d="M{16-1.7*w} {y+0.6} Q{16-1.2} {y-4.5} 16 {y-6.8} Q{16+1.2} {y-4.5} {16+1.7*w} {y+0.6} Q16 {y-0.8} {16-1.7*w} {y+0.6}Z" fill="{claw}" stroke-width="1.1"/></g>')
    body = (t(-40, 11.5, 0.9) + t(40, 11.5, 0.9) + t(0, 8, 1.0) +
            '<path d="M9.6 21.5 Q9.4 27.8 16 28.6 Q22.6 27.8 22.4 21.5 Q19 18.2 16 18.4 Q13 18.2 9.6 21.5Z" fill="url(#%s)"/>' % gid +
            '<path d="M12.2 22.4 Q14 20.4 16.4 20.6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2" stroke-linecap="round"/>')
    f = ('<feDropShadow dx="0" dy="0" stdDeviation="1" flood-color="#fff3b0" flood-opacity="1"/>' if glow else
         '<feDropShadow dx=".7" dy="1" stdDeviation=".6" flood-color="#000" flood-opacity=".6"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient><filter id="f{gid}" x="-30%" y="-30%" width="160%" height="160%">{f}</filter></defs>'
            f'<g filter="url(#f{gid})" stroke="#24150a" stroke-width="1.4" stroke-linejoin="round"><g transform="translate(-1 -1) rotate(-30 16 22) translate(16 22) scale(.9) translate(-16 -22)">{body}</g></g></svg>')
def fist(c1, c2, gid, claw='#fbf3e0'):
    def t(rot, y, w=1.0, cr=0):
        # короткий согнутый палец; коготь загнут внутрь (к подушке)
        return (f'<g transform="rotate({rot} 16 22)">'
                f'<path d="M{16-3.7*w} 22 L{16-2.6*w} {y} Q16 {y-3.2} {16+2.6*w} {y} L{16+3.7*w} 22 Z" fill="url(#{gid})"/>'
                f'<path d="M{16-1.5} {y-0.6} Q{16+2.6} {y-2.6} {16+1.2} {y+3.6} Q{16+0.6} {y+0.6} {16-1.5} {y-0.6}Z" fill="{claw}" stroke-width="1.1" transform="rotate({cr} 16 {y})"/></g>')
    kn = [(10.9, 17.8, 3.0), (16, 15.4, 3.4), (21.1, 17.8, 3.0)]
    body = ('<path d="M9.2 21.3 Q9.0 28.2 16 29 Q23 28.2 22.8 21.3 Q19 18 16 18.2 Q13 18 9.2 21.3Z" fill="url(#%s)"/>' % gid +
            ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#{gid})"/>' for x, y, r in kn) +
            '<path d="M12.4 24.6 Q14.4 23 16.6 23.2" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.1" stroke-linecap="round"/>')
    f = '<feDropShadow dx=".5" dy=".7" stdDeviation=".5" flood-color="#000" flood-opacity=".6"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient><filter id="f{gid}" x="-30%" y="-30%" width="160%" height="160%">{f}</filter></defs>'
            f'<g filter="url(#f{gid})" stroke="#24150a" stroke-width="1.4" stroke-linejoin="round"><g transform="translate(-1 -1) rotate(-30 16 22) translate(16 22) scale(1.08) translate(-16 -22)">{body}</g></g></svg>')
open('/tmp/cur/paw.svg', 'w').write(paw('#c2f59a', '#3f8a26', 'g1'))
open('/tmp/cur/paw_d.svg', 'w').write(fist('#a9e47e', '#357a1f', 'g3'))
