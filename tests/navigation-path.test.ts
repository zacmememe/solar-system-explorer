import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { flightArch, planFlightArch, satelliteViewDirection, sweepClear, type NavigationScene } from '../src/camera/NavigationPath';
import { CameraController } from '../src/camera/CameraController';
import type { CameraCommand } from '../src/contracts/camera';
import { BodyPoseProvider } from '../src/astronomy/BodyPoseProvider';
describe('导航真实几何回归', () => {
    it('参考系变换中旧卫星很早扫过起点，使用局部早绕行而非巨幅远飞', () => {
        const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
        const scene: NavigationScene = { samples: 192, revision: 'short-transfer', sample: seconds => [
                { id: 'io', position: new T.Vector3(100000 * ease(seconds / .15), 0, 0), radius: .12 },
            ] };
        const start = new T.Vector3(.45, 0, 0), end = new T.Vector3(-40, 0, 0), raw = (t: number) => start.clone().lerp(end, ease(t));
        const detour = planFlightArch(scene, .15, raw, start, end);
        expect(detour).not.toBeNull();
        expect(detour!.offset.length()).toBeLessThan(10);
        for (let i = 0; i <= 10000; i++) {
            const t = i / 10000, b = scene.sample(t * .15)[0];
            expect(raw(t).addScaledVector(detour!.offset, flightArch(t, detour!.skew)).distanceTo(b.position)).toBeGreaterThanOrEqual(b.radius);
        }
    });
    it.each([1.7, 10])('真实米制月表 %sm 净空的径向起飞不会被曲率包络误拒绝', height => {
        const radius = .3681509967;
        const scene: NavigationScene = { samples: 192, revision: 'surface', sample: () => [{ id: 'moon', position: new T.Vector3(), radius }] };
        const start = new T.Vector3(radius * (1 + height / 1737400), 0, 0), end = new T.Vector3(1.3468348818, 0, 0);
        const raw = (t: number) => start.clone().lerp(end, t * t * t * (t * (t * 6 - 15) + 10));
        expect(planFlightArch(scene, 2.5, raw, start, end)?.offset.length()).toBe(0);
    });
    it('极快小卫星的弦中点擦碰不能被粗采样漏掉', () => {
        const omega = 2 * Math.PI * (86400 / 3600) / (0.31891023 * 24), duration = 2.5;
        const scene: NavigationScene = { samples: 1255, revision: 'fast', sample: s => [
                { id: 'phobos', position: new T.Vector3(9376 * Math.cos(omega * (s - duration / 2)), 9376 * Math.sin(omega * (s - duration / 2)), 0), radius: 11.26 },
            ] };
        const raw = (t: number) => new T.Vector3(9376 + 11.26 - .1 + 10000 * (t - .5) ** 2, 0, 0);
        const arc = planFlightArch(scene, duration, raw, raw(0), raw(1));
        expect(arc?.offset.length()).toBeGreaterThan(0);
        for (let i = 0; i <= 10000; i++) {
            const t = i / 10000, b = scene.sample(t * duration)[0];
            expect(raw(t).addScaledVector(arc!.offset, flightArch(t, arc!.skew)).distanceTo(b.position)).toBeGreaterThanOrEqual(b.radius);
        }
    });
    it('策略预测不推进时钟/状态，与实际推进后的相同姿态相符', () => {
        const predicted = new BodyPoseProvider('NAV_SCHEMATIC'), actual = new BodyPoseProvider('NAV_SCHEMATIC');
        for (const p of [predicted, actual]) {
            p.setPhysicalReferenceBody('mars');
            p.setPolicy('PHYSICAL_OBSERVATION', .15);
        }
        const future = predicted.getBodyPose('phobos', 123, .12);
        expect(predicted.getTransitionProgress()).toBe(0);
        actual.update(.12);
        const result = actual.getBodyPose('phobos', 123);
        expect(future.position.distanceTo(result.position)).toBeLessThan(1e-10);
        expect(future.renderSurfaceRadius).toBeCloseTo(result.renderSurfaceRadius, 12);
        actual.setPolicy('PHYSICAL_OBSERVATION', 0);
        expect(actual.getTransitionProgress()).toBe(1);
        const retargeted = new BodyPoseProvider('NAV_SCHEMATIC');
        retargeted.setPolicy('PHYSICAL_OBSERVATION', 1.2);
        retargeted.update(.1);
        retargeted.setPolicy('PHYSICAL_OBSERVATION', .15);
        expect(retargeted.predictTransitionProgress(.15)).toBe(1);
    });
    it('连续线段扫掠能发现两端都在球外的穿心路径，也支持移动和增长的球', () => {
        expect(sweepClear(new T.Vector3(-3, 0, 0), new T.Vector3(3, 0, 0), 1, 1)).toBe(false);
        expect(sweepClear(new T.Vector3(-3, 2, 0), new T.Vector3(3, 2, 0), 1, 1)).toBe(true);
        expect(sweepClear(new T.Vector3(2, 0, 0), new T.Vector3(2, 0, 0), 1, 3)).toBe(false);
        expect(sweepClear(new T.Vector3(-1e6, 0, 0), new T.Vector3(1e6, 0, 0), .01, .01)).toBe(false);
        expect(sweepClear(new T.Vector3(-1e4, 0, 0), new T.Vector3(1e4, 0, 0), .0001, .0001)).toBe(false);
    });
    it.each([false, true])('规划绕开居中的行星，密集独立采样验证净空（运动=%s）', (moving) => {
        const scene: NavigationScene = { samples: 192, revision: 'test', sample: s => [
                { id: 'earth', position: new T.Vector3(0, moving ? Math.sin(s * 3) : 0, 0), radius: 2 + s * .1 },
            ] };
        const start = new T.Vector3(6, 0, 0), end = new T.Vector3(-6, 0, 0);
        const raw = (t: number) => start.clone().lerp(end, t);
        const arc = planFlightArch(scene, 2.5, raw, start, end);
        expect(arc).not.toBeNull();
        for (let i = 0; i <= 10000; i++) {
            const t = i / 10000, b = scene.sample(t * 2.5)[0];
            expect(raw(t).addScaledVector(arc!.offset, flightArch(t, arc!.skew)).distanceTo(b.position)).toBeGreaterThanOrEqual(b.radius);
        }
    });
    it('终点在实体内时拒绝规划，不能静默走回穿模直线', () => {
        const scene: NavigationScene = { samples: 128, revision: 'test', sample: () => [{ id: 'sun', position: new T.Vector3(), radius: 2 }] };
        const start = new T.Vector3(5, 0, 0), end = new T.Vector3();
        expect(planFlightArch(scene, 1, t => start.clone().lerp(end, t), start, end)).toBeNull();
    });
    it.each([16 / 9, 9 / 16])('卫星位于前景且母星中心在视野内（aspect=%s）', aspect => {
        const parent = new T.Vector3(), moon = new T.Vector3(10, 2, 4);
        const direction = satelliteViewDirection(moon, parent, 2, 45, aspect, new T.Vector3(1, 0, 0));
        const camera = new T.PerspectiveCamera(45, aspect, .001, 1000);
        camera.position.copy(moon).addScaledVector(direction, .5);
        camera.lookAt(moon);
        camera.updateMatrixWorld();
        const ndc = parent.clone().project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(1);
        expect(Math.abs(ndc.y)).toBeLessThan(1);
        expect(Math.abs(ndc.z)).toBeLessThan(1);
    });
});
describe('真实相机姿态连续性', () => {
    it('绕行时姿态沿端点最短旋转，转速受缓动曲线约束而非追逐移动的临时支点',()=>{
        const camera=new T.PerspectiveCamera(45,16/9,.001,2000);
        const scene:NavigationScene={samples:192,revision:'static',sample:()=>[
            {id:'earth',position:new T.Vector3(),radius:2},{id:'mars',position:new T.Vector3(-20,0,0),radius:1}]};
        const controller=new CameraController({camera,navigationScene:()=>scene});
        const pose=(id:string)=>({pos:new T.Vector3(id==='mars'?-20:0,0,0),radius:id==='mars'?1:2});
        controller.update(0,pose);controller.setSphericalDirect(6,Math.PI/2,Math.PI/2);
        controller.executeCommand({type:'flyTo',bodyId:'mars',viewDirection:[1,0,0],durationSec:2.5});
        expect(controller.navigationBlocked).toBe(false);
        const last=camera.quaternion.clone();
        for(let i=0;i<300;i++){
            controller.update(2.5/300,pose);
            expect(camera.quaternion.angleTo(last)).toBeLessThan(Math.PI*1.875/300+1e-6);
            last.copy(camera.quaternion);
        }
    });
    const commands: CameraCommand[] = [{ type: 'overview' }, { type: 'flyTo', bodyId: 'mars' },
        { type: 'restoreBookmark', targetBodyId: 'earth', spherical: { radius: 6, phi: 1, theta: 2 } },
        { type: 'focusRegion', bodyId: 'earth', lat: 10, lon: 30 }];
    const rig = () => {
        const camera = new T.PerspectiveCamera(45, 16 / 9, .001, 1000), controller = new CameraController({ camera });
        const getPose = (id: string) => ({ pos: new T.Vector3(id === 'mars' ? 20 : 0, 0, 0), radius: 2 });
        controller.update(0, getPose);
        return { camera, controller, getPose };
    };
    it.each(commands)('地表到 $type 从实际位置和方向起步', command => {
        const { camera, controller, getPose } = rig();
        controller.executeCommand({ type: 'enterSurfaceLook', bodyId: 'earth', lat: 0, lon: 0, initialYawDeg: 90, initialPitchDeg: 12 });
        const pos = camera.position.clone(), quat = camera.quaternion.clone();
        controller.executeCommand(command);
        controller.update(0, getPose);
        expect(camera.position.distanceTo(pos)).toBeLessThan(1e-8);
        expect(camera.quaternion.angleTo(quat)).toBeLessThan(1e-7);
    });
    it('中途改目标和取消保留画面，后续不会恢复旧飞行', () => {
        const { camera, controller, getPose } = rig();
        controller.executeCommand({ type: 'flyTo', bodyId: 'mars', lookTarget: { kind: 'body', bodyId: 'sun' } });
        controller.update(.8, getPose);
        const pos = camera.position.clone(), quat = camera.quaternion.clone();
        controller.executeCommand({ type: 'flyTo', bodyId: 'mars', lookTarget: { kind: 'body', bodyId: 'sun' } });
        controller.update(0, getPose);
        expect(camera.position.distanceTo(pos)).toBeLessThan(1e-8);
        expect(camera.quaternion.angleTo(quat)).toBeLessThan(1e-7);
        controller.update(.4, getPose);
        const p2 = camera.position.clone(), q2 = camera.quaternion.clone();
        controller.cancelFlight();
        controller.update(1, getPose);
        expect(camera.position.distanceTo(p2)).toBeLessThan(1e-8);
        expect(camera.quaternion.angleTo(q2)).toBeLessThan(1e-7);
        expect(controller.getSnapshot().isTransitioning).toBe(false);
    });
});
