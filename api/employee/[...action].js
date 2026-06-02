import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    try {
        const pathOnly = req.url.split('?')[0];
        const rawAction = pathOnly.replace('/api/employee/', '').replace('/api/employee', '');
        const action = rawAction || '';

        // 员工登录
        if (action === 'login' && req.method === 'POST') {
            const { phone, password } = req.body || {};
            if (!phone || !password) return res.status(400).json({ error: '缺少参数' });
            const empStr = await redis.get(`employee:${phone}`);
            if (!empStr) return res.status(401).json({ error: '账号或密码错误' });
            const emp = JSON.parse(empStr);
            if (emp.password !== password || emp.status !== 'active') return res.status(401).json({ error: '账号或密码错误' });
            const token = Buffer.from(`${phone}:${password}`).toString('base64');
            return res.status(200).json({ token, name: emp.name, phone });
        }

        // 辅助函数：验证员工身份
        const authEmployee = async (authHeader) => {
            if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
            const token = authHeader.split(' ')[1];
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [phone, password] = decoded.split(':');
                const empStr = await redis.get(`employee:${phone}`);
                if (!empStr) return null;
                const emp = JSON.parse(empStr);
                return (emp.password === password && emp.status === 'active') ? { phone, ...emp } : null;
            } catch { return null; }
        };

        // 今日打卡状态
        if (action === 'today' && req.method === 'GET') {
            const emp = await authEmployee(req.headers.authorization);
            if (!emp) return res.status(401).json({ error: '未登录' });
            const today = new Date().toISOString().slice(0,10);
            const record = await redis.get(`attendance:${emp.phone}:${today}`);
            if (record) {
                const r = JSON.parse(record);
                return res.status(200).json({ checkIn: r.checkIn || '', checkOut: r.checkOut || '' });
            }
            return res.status(200).json({ checkIn: '', checkOut: '' });
        }

        // 上班打卡
        if (action === 'checkin' && req.method === 'POST') {
            const emp = await authEmployee(req.headers.authorization);
            if (!emp) return res.status(401).json({ error: '未登录' });
            const today = new Date().toISOString().slice(0,10);
            const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            let record = await redis.get(`attendance:${emp.phone}:${today}`);
            record = record ? JSON.parse(record) : {};
            if (record.checkIn) return res.status(400).json({ error: '今天已经打过上班卡' });
            record.checkIn = time;
            await redis.set(`attendance:${emp.phone}:${today}`, JSON.stringify(record));
            return res.status(200).json({ success: true });
        }

        // 下班打卡
        if (action === 'checkout' && req.method === 'POST') {
            const emp = await authEmployee(req.headers.authorization);
            if (!emp) return res.status(401).json({ error: '未登录' });
            const today = new Date().toISOString().slice(0,10);
            const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            let record = await redis.get(`attendance:${emp.phone}:${today}`);
            record = record ? JSON.parse(record) : {};
            if (!record.checkIn) return res.status(400).json({ error: '请先打上班卡' });
            if (record.checkOut) return res.status(400).json({ error: '今天已经打过下班卡' });
            record.checkOut = time;
            await redis.set(`attendance:${emp.phone}:${today}`, JSON.stringify(record));
            return res.status(200).json({ success: true });
        }

        // 查看自己的考勤记录
        if (action === 'records' && req.method === 'GET') {
            const emp = await authEmployee(req.headers.authorization);
            if (!emp) return res.status(401).json({ error: '未登录' });
            const keys = await redis.keys(`attendance:${emp.phone}:*`);
            const records = [];
            for (const key of keys) {
                const data = await redis.get(key);
                if (data) {
                    const r = JSON.parse(data);
                    records.push({
                        date: key.split(':')[2],
                        checkIn: r.checkIn || '',
                        checkOut: r.checkOut || ''
                    });
                }
            }
            records.sort((a,b) => b.date.localeCompare(a.date));
            return res.status(200).json({ records });
        }

        return res.status(404).json({ error: '接口不存在' });
    } catch (err) {
        return res.status(500).json({ error: '服务器内部错误' });
    }
}
