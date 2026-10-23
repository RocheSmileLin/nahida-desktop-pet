# -*- coding: utf-8 -*-
"""
加部件 · 一键编排：3D 处理 → 接线 → 验证

    python tools\\add_part.py -c tools\\parts\\猫娘服装.json            # 预演（不动盘）
    python tools\\add_part.py -c tools\\parts\\猫娘服装.json --apply     # 真跑

流程：
  1) 3D 阶段（add_part_3d.py）：导入/对齐/材质/UV/挂骨/权重/验收/存盘
     ⚠️ 需要 Blender 未被占用（会无头打开并保存 .blend）。
        若 Blender 正开着，本脚本会拒绝跑 3D，只提示你用 MCP 跑或先关掉。
  2) 接线阶段（add_part_wire.py）：5 个前端 + 2 个 json（幂等，自动备份）
  3) 验证：JS 语法 / 漏挂 / 死键 / 桌宠 /petparts
"""
import os, sys, json, subprocess, argparse, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLENDER = r'E:/Blender/blender.exe'
BLEND = os.path.join(ROOT, '纳西妲完美版_骨骼中文化.blend')


def log(*a):
    print('[编排]', *a)


def blender_running():
    try:
        out = subprocess.run(['tasklist'], capture_output=True, text=True, encoding='gbk', errors='replace').stdout
        return 'blender.exe' in out.lower()
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-c', '--config', required=True)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--skip-3d', action='store_true')
    ap.add_argument('--skip-wire', action='store_true')
    a = ap.parse_args()

    cfgp = os.path.abspath(a.config)
    if not os.path.exists(cfgp):
        raise SystemExit('配置不存在: %s' % cfgp)
    cfg = json.load(open(cfgp, encoding='utf-8'))
    name = cfg['name']
    log('配置:', cfgp, '| 部件:', name, '| apply =', a.apply)

    py = sys.executable

    if not a.skip_3d:
        if blender_running():
            log('⚠️ Blender 正在运行 —— 无头跑 3D 会和你当前会话抢 .blend，已跳过 3D 阶段。')
            log('   两种办法：① 关掉 Blender 再跑；② 让 Hermes 用 MCP 在活会话里执行 add_part_3d.py')
        else:
            script3d = os.path.join(ROOT, 'tools', 'add_part_3d.py')
            cmd = [BLENDER, '-b', BLEND, '--python', script3d, '--', '--config', cfgp]
            if a.apply:
                cmd.append('--apply')
            log('跑 3D:', ' '.join(cmd))
            r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
            tail = [l for l in (r.stdout or '').splitlines() if '[加部件]' in l]
            print('\n'.join(tail) if tail else (r.stdout or '')[-2000:])
            if r.returncode != 0:
                print((r.stderr or '')[-1500:])
                raise SystemExit('3D 阶段失败（exit %d）' % r.returncode)

    if not a.skip_wire:
        w = os.path.join(ROOT, 'tools', 'add_part_wire.py')
        cmd = [py, w, '-c', cfgp] + (['--apply'] if a.apply else [])
        log('跑接线:', ' '.join(cmd))
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        print(r.stdout or '', (r.stderr or '')[-1500:])
        if r.returncode != 0:
            raise SystemExit('接线阶段失败（exit %d）' % r.returncode)

    if a.apply:
        log('完成 ✅  下一步（你来做）：')
        log('  1. Blender 里确认外观 → Ctrl+S')
        log('  2. 导出 PMX（tools/导出PMX.py 或菜单 mmd_tools → 导出）')
        log('  3. 重启桌宠：关掉 8810 那个进程，再跑 pet_app.py')
        log('  4. 设置页 → 部件，勾上新部件验收')
    else:
        log('预演结束（未改动任何文件）')


if __name__ == '__main__':
    main()
