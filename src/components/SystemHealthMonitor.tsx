import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const SystemHealthMonitor = () => {
  const [status, setStatus] = useState({
    blockchain: 'checking',
    ipfs: 'checking',
    discord: 'checking'
  });

  useEffect(() => {
    checkServices();
  }, []);

  const checkServices = async () => {
    // Simulate service checks (replace with actual service checks in production)
    setTimeout(() => {
      setStatus({
        blockchain: 'connected',
        ipfs: 'connected',
        discord: 'connected'
      });
    }, 2000);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'connected': return 'Operational';
      case 'error': return 'Error';
      default: return 'Checking...';
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>System Health</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Object.entries(status).map(([service, state]) => (
            <div key={service} className="flex items-center justify-between p-2 border rounded">
              <span className="capitalize font-medium">{service}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  {getStatusText(state)}
                </span>
                <div className={`w-3 h-3 rounded-full ${getStatusColor(state)}`} />
              </div>
            </div>
          ))}
        </div>

        {Object.values(status).some(s => s === 'error') && (
          <Alert className="mt-4" variant="destructive">
            <AlertDescription>
              Some services are experiencing issues. Please try again later.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default SystemHealthMonitor;