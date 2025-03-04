import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Vote, Clock, TrendingUp } from 'lucide-react';

const VotingAnalyticsDashboard = () => {
  const [metrics, setMetrics] = useState({
    participationRate: 0,
    totalVotes: 0,
    activeProposals: 0,
    avgVotingTime: 0
  });

  const [participationData, setParticipationData] = useState([]);
  const [proposalStats, setProposalStats] = useState([]);

  useEffect(() => {
    // Simulated data for demonstration
    setMetrics({
      participationRate: 75.5,
      totalVotes: 12543,
      activeProposals: 8,
      avgVotingTime: 2.3
    });

    setParticipationData([
      { month: 'Jan', participation: 65 },
      { month: 'Feb', participation: 70 },
      { month: 'Mar', participation: 75 },
      { month: 'Apr', participation: 72 },
      { month: 'May', participation: 78 },
      { month: 'Jun', participation: 75 }
    ]);

    setProposalStats([
      { name: 'Proposal A', votes: 2340 },
      { name: 'Proposal B', votes: 1890 },
      { name: 'Proposal C', votes: 2800 },
      { name: 'Proposal D', votes: 1500 },
      { name: 'Proposal E', votes: 2100 }
    ]);
  }, []);

  const MetricCard = ({ title, value, icon: Icon, suffix = '' }) => (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <h3 className="text-2xl font-bold mt-2">
              {value.toLocaleString()}{suffix}
            </h3>
          </div>
          <Icon className="h-8 w-8 text-gray-400" />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 p-8">
      <h2 className="text-3xl font-bold">Voting Analytics</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Participation Rate"
          value={metrics.participationRate}
          icon={Users}
          suffix="%"
        />
        <MetricCard
          title="Total Votes"
          value={metrics.totalVotes}
          icon={Vote}
        />
        <MetricCard
          title="Active Proposals"
          value={metrics.activeProposals}
          icon={TrendingUp}
        />
        <MetricCard
          title="Avg. Voting Time"
          value={metrics.avgVotingTime}
          icon={Clock}
          suffix=" days"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Participation Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={participationData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="participation" 
                    stroke="#22c55e"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Votes per Proposal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={proposalStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar 
                    dataKey="votes" 
                    fill="#22c55e"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default VotingAnalyticsDashboard;