import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ADMIN_PASSWORD = 'zjm1314520';

export default async function handler(req, res) {
    try {
        const pathOnly = req.url.split('?')[0];
        const rawAction = pathOnly.replace('/api/admin/', '').replace('/api/admin', '');
        const action = rawAction || '';

        const adminToken = req.headers['x-admin-token'];
        if (adminToken !== ADMIN_PASSWORD) return res.status(403).json({ error: '禁止访问' });

        // 员工列表
        if (action === 'employees' && req.method === 'GET') {
            const keys = await redis.keys('employee:*');
            const employees = [];
            for (const key of keys) {
                const data = await redis.get(key);
                if (data) {
                    const emp = typeof data === 'string' ? JSON.parse(data) : data;
                    employees.push({ phone: key.replace('employee:', ''), ...emp });
                }
            }
            return res.status(200).json({ employees });
        }

        // 新增员工
        if (action === 'employees' && req.method === 'POST') {
            const { name, phone, position, password } = req.body;
            if (!name || !phone || !password) return res.status(400).json({ error: '缺少参数' });
            const existing = await redis.get(`employee:${phone}`);
            if (existing) return res.status(400).json({ error: '手机号已存在' });
            await redis.set(`employee:${phone}`, JSON.stringify({
                name, password, position: position || '', status: 'active'
            }));
            return res.status(200).json({ success: true });
        }

        // 修改员工（重置密码或切换状态）
        if (action === 'employees' && req.method === 'PUT') {
            const { phone, password, toggleStatus } = req.body;
            if (!phone) return res.status(400).json({ error: '缺少手机号' });
            const empStr = await redis.get(`employee:${phone}`);
            if (!empStr) return res.status(404).json({ error: '员工不存在' });
            const emp = JSON.parse(empStr);
            if (password) emp.password = password;
            if (toggleStatus) emp.status = emp.status === 'active' ? 'disabled' : 'active';
            await redis.set(`employee:${phone}`, JSON.stringify(emp));
            return res.status(200).json({ success: true });
        }

        // 考勤记录查询
        if (action === 'records' && req.method === 'GET') {
            const { phone, start, end } = req.query;
            if (!phone || !start || !end) return res.status(400).json({ error: '参数不全' });
            const empData = await redis.get(`employee:${phone}`);
            const employee = empData ? JSON.parse(empData) : { name: '未知' };
            const keys = await redis.keys(`attendance:${phone}:*`);
            const records = [];
            const sd = new Date(start), ed = new Date(end);
            ed.setHours(23,59,59,999);
            for (const key of keys) {
                const data = await redis.get(key);
                if (!data) continue;
                const record = JSON.parse(data);
                const date = key.split(':')[2];
                const d = new Date(date);
                if (d >= sd && d <= ed) {
                    records.push({
                        date,
                        name: employee.name,
                        checkIn: record.checkIn || '',
                        checkOut: record.checkOut || ''
                    });
                }
            }
            records.sort((a,b) => a.date.localeCompare(b.date));
            return res.status(200).json({ records });
        }

        return res.status(404).json({ error: '接口不存在' });
    } catch (err) {
        return res.status(500).json({ error: '服务器内部错误' });
    }
}
